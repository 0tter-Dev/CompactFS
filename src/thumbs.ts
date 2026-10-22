import { invoke } from "@tauri-apps/api/core";
import { LoadQueue, type LoadResult } from "./load-queue.ts";
import { Lru } from "./lru.ts";
import { decodeThumbnail, THUMB_PX } from "./thumb-codec.ts";

/** Quantas miniaturas já vistas ficam em memória (~147 KB cada, então cerca de 35 MB no máximo). */
const MAX_CACHED = 240;
/** Extrações simultâneas pedidas ao núcleo. */
const CONCURRENCY = 4;

async function fetchBitmap(path: string): Promise<ImageBitmap> {
  const buf = await invoke<ArrayBuffer>("thumbnail", { path, size: THUMB_PX });
  const { width, height, pixels } = decodeThumbnail(buf);
  return createImageBitmap(new ImageData(pixels, width, height));
}

export interface ThumbStats {
  requested: number;
  loaded: number;
  failed: number;
}

/** Cache em memória (miniaturas já vistas) e fila de carregamento com concorrência limitada. */
export class ThumbLoader {
  // `null` guarda "não tem miniatura": evita pedir de novo, a cada rolagem, o que já falhou.
  private readonly cache = new Lru<string, ImageBitmap | null>(MAX_CACHED, (_key, bitmap) => bitmap?.close());
  private readonly queue = new LoadQueue<ImageBitmap>(CONCURRENCY);
  readonly stats: ThumbStats = { requested: 0, loaded: 0, failed: 0 };
  onStats: ((stats: ThumbStats) => void) | undefined;

  /** `undefined` = ainda não pedida; `null` = sem miniatura; senão, a imagem. */
  peek(key: string): ImageBitmap | null | undefined {
    return this.cache.get(key);
  }

  /** Pede a miniatura. Devolve a função que cancela o interesse (a carga em andamento termina). */
  request(key: string, path: string, done: (bitmap: ImageBitmap | null) => void): () => void {
    const listener = (result: LoadResult<ImageBitmap>): void => done(result.ok ? result.value : null);
    this.stats.requested += 1;
    this.queue.request(
      key,
      async () => {
        try {
          const bitmap = await fetchBitmap(path);
          this.cache.set(key, bitmap);
          this.stats.loaded += 1;
          return bitmap;
        } catch (error) {
          this.cache.set(key, null);
          this.stats.failed += 1;
          throw error;
        } finally {
          this.onStats?.(this.stats);
        }
      },
      listener,
    );
    return () => this.queue.cancel(key, listener);
  }

  /** Ao trocar de pasta: o que ainda não começou deixa de importar. */
  clearPending(): void {
    this.queue.clearPending();
  }
}
