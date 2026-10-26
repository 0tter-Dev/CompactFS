import { allowView, convertFileSrc, openDefault, pdfInfo, readText, toViewError, type PdfInfo } from "./api.ts";
import { formatSize } from "./format.ts";
import { parseMarkdown } from "./markdown.ts";
import { renderMarkdown } from "./markdown-dom.ts";
import { PdfPages } from "./pdf-pages.ts";
import { usesAssetProtocol, type ViewerKind } from "./viewer-kind.ts";
import { clampPan, fitScale, fitted, zoomAt, zoomLabel, type ZoomState } from "./zoom.ts";

export interface ViewerItem {
  path: string;
  name: string;
  kind: ViewerKind;
  /** Posição do arquivo na lista da pasta (para devolver a seleção ao fechar). */
  index: number;
  size: number | null;
}

export interface ViewerElements {
  root: HTMLElement;
  close: HTMLButtonElement;
  title: HTMLElement;
  position: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  raw: HTMLButtonElement;
  openDefault: HTMLButtonElement;
  body: HTMLElement;
  note: HTMLElement;
}

export interface ViewerHooks {
  /** O visualizador foi fechado; `index` é o último arquivo visto. */
  onClose: (index: number) => void;
  /** Mensagem curta para a barra de status. */
  onMessage: (text: string) => void;
}

const ZOOM_STEP = 1.25;
const WHEEL_STEP = 1.15;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Visualizador em destaque: imagem (com zoom), vídeo, áudio, PDF, texto e markdown. */
export class Viewer {
  private readonly els: ViewerElements;
  private readonly hooks: ViewerHooks;
  private items: ViewerItem[] = [];
  private pos = -1;
  private token = 0;
  private showRaw = false;
  private markdownSource = "";
  private cleanup: (() => void) | null = null;
  private zoomKeys: ((e: KeyboardEvent) => boolean) | null = null;

  // Sem "parameter properties": o Node só remove tipos do TypeScript.
  constructor(els: ViewerElements, hooks: ViewerHooks) {
    this.els = els;
    this.hooks = hooks;
    els.close.addEventListener("click", () => this.close());
    els.prev.addEventListener("click", () => void this.step(-1));
    els.next.addEventListener("click", () => void this.step(1));
    els.openDefault.addEventListener("click", () => void this.openInDefaultApp());
    els.raw.addEventListener("click", () => {
      this.showRaw = !this.showRaw;
      void this.show();
    });
  }

  get isOpen(): boolean {
    return !this.els.root.hidden;
  }

  open(items: ViewerItem[], pos: number): void {
    if (items.length === 0 || pos < 0 || pos >= items.length) return;
    this.items = items;
    this.pos = pos;
    this.showRaw = false;
    this.els.root.hidden = false;
    void this.show();
    this.els.root.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.isOpen) return;
    const index = this.items[this.pos]?.index ?? -1;
    this.release();
    this.token += 1; // descarta qualquer carga em andamento
    this.els.body.replaceChildren();
    this.els.root.hidden = true;
    this.hooks.onClose(index);
  }

  /** Encerra sem avisar quem abriu (a tela está sendo trocada por outra): solta o arquivo. */
  dismiss(): void {
    if (this.els.root.hidden) return;
    this.release();
    this.token += 1;
    this.els.body.replaceChildren();
    this.els.root.hidden = true;
  }

  async step(delta: number): Promise<void> {
    const next = this.pos + delta;
    if (next < 0 || next >= this.items.length) return;
    this.pos = next;
    this.showRaw = false;
    await this.show();
  }

  /** Teclas do visualizador. Devolve `true` se a tecla foi tratada. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen || e.ctrlKey || e.metaKey) return false;
    const target = e.target as HTMLElement | null;
    // Dentro de um vídeo ou áudio, as setas mexem no tempo e no volume, não trocam de arquivo.
    const inMedia =
      target instanceof HTMLMediaElement ||
      target instanceof HTMLIFrameElement ||
      (target instanceof HTMLElement && target.closest(".pdf-pages") !== null);

    if (e.key === "Escape" || (e.key === "Backspace" && !inMedia)) {
      this.close();
      return true;
    }
    if (e.key === "PageUp" || (e.key === "ArrowLeft" && !inMedia && !e.altKey)) {
      void this.step(-1);
      return true;
    }
    if (e.key === "PageDown" || (e.key === "ArrowRight" && !inMedia && !e.altKey)) {
      void this.step(1);
      return true;
    }
    if (this.zoomKeys?.(e)) return true;
    return false;
  }

  // ---------- internos ----------

  private current(): ViewerItem | undefined {
    return this.items[this.pos];
  }

  /** Solta o arquivo atual: mídia parada e sem endereço, para o disco poder ser ejetado. */
  private release(): void {
    this.cleanup?.();
    this.cleanup = null;
    this.zoomKeys = null;
    for (const media of this.els.body.querySelectorAll("video, audio")) {
      const m = media as HTMLMediaElement;
      m.pause();
      m.removeAttribute("src");
      m.load();
    }
    // Remover o quadro do PDF encerra o visualizador e solta o arquivo.
    for (const frame of this.els.body.querySelectorAll("iframe")) frame.remove();
  }

  private updateChrome(item: ViewerItem): void {
    this.els.title.textContent = item.name;
    this.els.title.title = item.path;
    this.els.position.textContent = `${this.pos + 1} de ${this.items.length}`;
    this.els.prev.disabled = this.pos <= 0;
    this.els.next.disabled = this.pos >= this.items.length - 1;
    this.els.raw.hidden = item.kind !== "markdown";
    this.els.raw.textContent = this.showRaw ? "Ver formatado" : "Ver código-fonte";
  }

  private setNote(text: string): void {
    this.els.note.textContent = text;
  }

  private showMessage(title: string, detail: string): void {
    const box = element("div", "viewer-message");
    box.setAttribute("role", "alert");
    box.append(element("h2", undefined, title), element("p", undefined, detail));
    this.els.body.replaceChildren(box);
  }

  private async show(): Promise<void> {
    const item = this.current();
    if (!item) return;
    const token = ++this.token;
    this.release();
    this.els.body.replaceChildren(element("div", "viewer-loading", "Carregando…"));
    this.updateChrome(item);
    this.setNote("");

    try {
      // O PDF desenhado pelo núcleo (Android) não precisa do protocolo de arquivos.
      if (usesAssetProtocol(item.kind) && item.kind !== "pdf") {
        await allowView(item.path);
        if (token !== this.token) return;
      }
      switch (item.kind) {
        case "image":
          this.showImage(item, token);
          break;
        case "video":
        case "audio":
          this.showMedia(item, token);
          break;
        case "pdf":
          await this.showPdf(item, token);
          break;
        case "text":
        case "markdown":
          await this.showText(item, token);
          break;
      }
    } catch (error) {
      if (token !== this.token) return;
      const err = toViewError(error);
      this.showMessage("Não foi possível abrir este arquivo", err.message);
    }
  }

  private showImage(item: ViewerItem, token: number): void {
    const stage = element("div", "stage");
    const img = element("img");
    img.alt = item.name;
    img.draggable = false;
    let zoom: ZoomState = { scale: 1, x: 0, y: 0 };
    let fit = true;

    const box = (): { w: number; h: number } => ({ w: stage.clientWidth, h: stage.clientHeight });
    const apply = (): void => {
      img.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
      this.setNote(
        `${img.naturalWidth} × ${img.naturalHeight} px · ${zoomLabel(zoom.scale)}` +
          (item.size !== null ? ` · ${formatSize(item.size)}` : ""),
      );
    };
    const refit = (): void => {
      const { w, h } = box();
      zoom = fitted(img.naturalWidth, img.naturalHeight, w, h);
      fit = true;
      apply();
    };
    const zoomBy = (factor: number, px = 0, py = 0): void => {
      const { w, h } = box();
      zoom = zoomAt(zoom, factor, px, py, img.naturalWidth, img.naturalHeight, w, h);
      fit = false;
      apply();
    };
    const setScale = (scale: number): void => {
      const { w, h } = box();
      zoom = clampPan({ scale, x: 0, y: 0 }, img.naturalWidth, img.naturalHeight, w, h);
      fit = false;
      apply();
    };
    const fromCenter = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
      const r = stage.getBoundingClientRect();
      return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
    };

    img.addEventListener("load", () => {
      if (token !== this.token) return;
      // "load" dispara antes de a decodificação terminar: numa foto grande, a tela ficaria vazia por
      // um instante. O "Carregando…" fica até a imagem estar pronta para ser pintada.
      void img.decode().catch(() => {}).then(() => {
        if (token !== this.token) return;
        this.els.body.querySelector(".viewer-loading")?.remove();
        refit();
      });
    });
    img.addEventListener("error", () => {
      if (token !== this.token) return;
      this.showMessage(
        "Não foi possível mostrar esta imagem",
        "O arquivo pode estar corrompido ou em um formato que o app não reproduz. Tente “Abrir no app padrão”.",
      );
    });

    stage.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const p = fromCenter(e);
        zoomBy(e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, p.x, p.y);
      },
      { passive: false },
    );
    stage.addEventListener("dblclick", () => {
      // Decide pela ampliação de agora (e não por um "flag"): depois de + e -, a imagem pode estar
      // de volta ao tamanho de ajuste sem ter passado pelo ajuste automático.
      const { w, h } = box();
      const atFit = Math.abs(zoom.scale - fitScale(img.naturalWidth, img.naturalHeight, w, h)) < 0.005;
      if (atFit && zoom.scale < 1) setScale(1);
      else refit();
    });
    let drag: { x: number; y: number; zx: number; zy: number } | null = null;
    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, zx: zoom.x, zy: zoom.y };
      stage.setPointerCapture(e.pointerId);
      stage.classList.add("dragging");
    });
    stage.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const { w, h } = box();
      zoom = clampPan(
        { scale: zoom.scale, x: drag.zx + e.clientX - drag.x, y: drag.zy + e.clientY - drag.y },
        img.naturalWidth,
        img.naturalHeight,
        w,
        h,
      );
      apply();
    });
    const endDrag = (): void => {
      drag = null;
      stage.classList.remove("dragging");
    };
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);

    const observer = new ResizeObserver(() => {
      if (img.naturalWidth === 0) return;
      if (fit) refit();
      else zoomBy(1);
    });
    observer.observe(stage);
    this.cleanup = () => observer.disconnect();

    this.zoomKeys = (e) => {
      if (e.key === "+" || e.key === "=") zoomBy(ZOOM_STEP);
      else if (e.key === "-" || e.key === "_") zoomBy(1 / ZOOM_STEP);
      else if (e.key === "0") refit();
      else if (e.key === "1") setScale(1);
      else return false;
      return true;
    };

    stage.append(img);
    this.els.body.append(stage);
    // O endereço só é definido depois de tudo ligado, para não perder o evento "load".
    img.src = convertFileSrc(item.path);
  }

  private showMedia(item: ViewerItem, token: number): void {
    const isVideo = item.kind === "video";
    const media = element(isVideo ? "video" : "audio", isVideo ? "player" : "player audio-player");
    media.controls = true;
    media.preload = "metadata";
    media.addEventListener("loadedmetadata", () => {
      if (token !== this.token) return;
      const seconds = Math.round(media.duration);
      const parts: string[] = [];
      if (media instanceof HTMLVideoElement && media.videoWidth > 0) parts.push(`${media.videoWidth} × ${media.videoHeight} px`);
      if (Number.isFinite(seconds)) parts.push(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`);
      if (item.size !== null) parts.push(formatSize(item.size));
      this.setNote(parts.join(" · "));
    });
    media.addEventListener("error", () => {
      if (token !== this.token) return;
      this.showMessage(
        isVideo ? "Este vídeo não pode ser reproduzido aqui" : "Este áudio não pode ser reproduzido aqui",
        "O formato ou o codec não é suportado pelo app (MKV, HEVC e AVI costumam falhar). Tente “Abrir no app padrão”.",
      );
    });

    const wrap = element("div", isVideo ? "stage media-stage" : "stage audio-stage");
    if (!isVideo) {
      wrap.append(element("div", "audio-icon", "🎵"), element("div", "audio-name", item.name));
    }
    wrap.append(media);
    this.els.body.replaceChildren(wrap);
    media.src = convertFileSrc(item.path);
  }

  private async showPdf(item: ViewerItem, token: number): Promise<void> {
    const info = await pdfInfo(item.path);
    if (token !== this.token) return;
    if (info) {
      this.showPdfPages(item, info);
      return;
    }
    // Windows: visualizador de PDF nativo do WebView2, dentro de um quadro.
    await allowView(item.path);
    if (token !== this.token) return;
    const frame = element("iframe", "pdf-frame");
    frame.title = item.name;
    this.els.body.replaceChildren(frame);
    frame.src = convertFileSrc(item.path);
    this.setNote(item.size !== null ? formatSize(item.size) : "");
  }

  /** Android: o núcleo desenha as páginas (o WebView não tem visualizador de PDF). */
  private showPdfPages(item: ViewerItem, info: PdfInfo): void {
    const pages = new PdfPages(item.path, info, item.name);
    this.els.body.replaceChildren(pages.root);
    this.cleanup = () => pages.dispose();
    const count = `${info.pages} ${info.pages === 1 ? "página" : "páginas"}`;
    this.setNote(item.size !== null ? `${count} · ${formatSize(item.size)}` : count);
    pages.root.focus({ preventScroll: true });
  }

  private async showText(item: ViewerItem, token: number): Promise<void> {
    const content = await readText(item.path);
    if (token !== this.token) return;
    this.markdownSource = content.text;

    const wrap = element("div", "text-stage");
    wrap.tabIndex = 0;
    if (item.kind === "markdown" && !this.showRaw) {
      const doc = element("article", "markdown");
      // O arquivo não confiável vira só uma árvore de dados; nada de HTML.
      doc.append(renderMarkdown(parseMarkdown(this.markdownSource)));
      wrap.append(doc);
    } else {
      wrap.append(element("pre", "plain-text", content.text));
    }
    this.els.body.replaceChildren(wrap);

    const notes = [content.encoding.toUpperCase(), formatSize(content.totalBytes)];
    if (content.truncated) notes.push("arquivo grande: mostrando só o começo");
    this.setNote(notes.join(" · "));
  }

  private async openInDefaultApp(): Promise<void> {
    const item = this.current();
    if (!item) return;
    try {
      await openDefault(item.path);
      this.hooks.onMessage(`Abrindo ${item.name} no app padrão…`);
    } catch (error) {
      this.hooks.onMessage(toViewError(error).message);
    }
  }
}
