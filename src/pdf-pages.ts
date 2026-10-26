import { pdfPage, type PdfInfo } from "./api.ts";
import { pageRatio, pagesToKeep, pdfRenderWidth } from "./pdf-model.ts";

const CONCURRENCY = 2;

/**
 * PDF desenhado pelo núcleo, página por página (Android, onde o WebView não tem visualizador de PDF).
 * Só as páginas perto da tela ficam desenhadas, para a memória não crescer com o tamanho do documento.
 */
export class PdfPages {
  readonly root: HTMLElement;
  private readonly path: string;
  private readonly info: PdfInfo;
  private readonly pages: HTMLElement[] = [];
  private readonly drawn = new Set<number>();
  private readonly queued = new Set<number>();
  private readonly visible = new Set<number>();
  private queue: number[] = [];
  private running = 0;
  private disposed = false;
  private readonly observer: IntersectionObserver;

  constructor(path: string, info: PdfInfo, label: string) {
    this.path = path;
    this.info = info;
    this.root = document.createElement("div");
    this.root.className = "pdf-pages";
    this.root.tabIndex = 0;
    this.root.setAttribute("aria-label", label);

    const ratio = pageRatio(info.width, info.height);
    for (let i = 0; i < info.pages; i++) {
      const page = document.createElement("div");
      page.className = "pdf-page";
      page.style.aspectRatio = String(ratio);
      page.dataset.index = String(i);
      const canvas = document.createElement("canvas");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Página ${i + 1} de ${info.pages}`);
      page.append(canvas);
      this.root.append(page);
      this.pages.push(page);
    }

    this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), {
      root: this.root,
      rootMargin: "800px 0px",
    });
    for (const page of this.pages) this.observer.observe(page);
  }

  dispose(): void {
    this.disposed = true;
    this.observer.disconnect();
    this.queue = [];
    for (const page of this.pages) {
      const canvas = page.firstElementChild as HTMLCanvasElement;
      canvas.width = 0;
      canvas.height = 0;
    }
    this.root.remove();
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const index = Number((entry.target as HTMLElement).dataset.index);
      if (entry.isIntersecting) this.visible.add(index);
      else this.visible.delete(index);
    }
    if (this.visible.size === 0) return;
    const focus = Math.min(...this.visible);
    const keep = pagesToKeep(focus, this.info.pages);
    // As páginas visíveis primeiro, da de cima para a de baixo.
    this.queue = [...this.visible].filter((i) => keep.has(i) && !this.drawn.has(i)).sort((a, b) => a - b);
    for (const i of [...this.drawn]) if (!keep.has(i)) this.evict(i);
    this.pump();
  }

  private evict(index: number): void {
    const canvas = this.pages[index]?.firstElementChild as HTMLCanvasElement | undefined;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    this.drawn.delete(index);
  }

  private pump(): void {
    while (!this.disposed && this.running < CONCURRENCY && this.queue.length > 0) {
      const index = this.queue.shift()!;
      if (this.drawn.has(index) || this.queued.has(index)) continue;
      this.queued.add(index);
      this.running += 1;
      void this.render(index).finally(() => {
        this.queued.delete(index);
        this.running -= 1;
        this.pump();
      });
    }
  }

  private async render(index: number): Promise<void> {
    const page = this.pages[index]!;
    const width = pdfRenderWidth(page.clientWidth || this.root.clientWidth, window.devicePixelRatio);
    try {
      const buffer = await pdfPage(this.path, index, width);
      if (this.disposed) return;
      const bitmap = await createImageBitmap(new Blob([buffer], { type: "image/jpeg" }));
      if (this.disposed) {
        bitmap.close();
        return;
      }
      const canvas = page.firstElementChild as HTMLCanvasElement;
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
      page.style.aspectRatio = String(pageRatio(bitmap.width, bitmap.height));
      bitmap.close();
      this.drawn.add(index);
    } catch {
      page.classList.add("pdf-page-error");
    }
  }
}
