import type { Entry } from "./api.ts";
import { isThumbnailable } from "./file-types.ts";
import { formatSize, joinPath } from "./format.ts";
import { thumbKey } from "./thumb-codec.ts";
import type { ThumbLoader } from "./thumbs.ts";
import {
  gridLayout,
  gridPosition,
  gridRange,
  moveGridSelection,
  scrollTopToReveal,
  type GridKey,
  type GridLayout,
} from "./viewport.ts";

const TILE_W = 148;
const TILE_H = 164;
const PAD = 12;
/** O tile ocupa o "slot" menos esta margem, para haver respiro entre eles. */
const TILE_GAP = 4;
const OVERSCAN_ROWS = 2;
/** Só pede a miniatura se o tile continuar na tela por este tempo (rolagem rápida não gera pedidos). */
const REQUEST_DELAY_MS = 90;

interface TileView {
  el: HTMLElement;
  glyph: HTMLElement;
  canvas: HTMLCanvasElement;
  name: HTMLElement;
  /** Entrada e versão a que o tile está ligado; evita refazer o trabalho a cada quadro de rolagem. */
  bound: Entry | null;
  version: number;
  key: string;
  timer: number;
  cancel: (() => void) | null;
}

export interface GalleryHooks {
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
}

/** Visão em grade, virtualizada: só os tiles visíveis (mais uma folga) existem no DOM. */
export class Gallery {
  private readonly pool: TileView[] = [];
  private entries: Entry[] = [];
  private dir = "";
  private separator = "\\";
  private selected = -1;
  private layout: GridLayout = { cols: 1, rows: 0, offsetX: PAD, height: 0 };
  private version = 0;
  private frame = 0;
  private readonly root: HTMLElement;
  private readonly sizer: HTMLElement;
  private readonly loader: ThumbLoader;
  private readonly hooks: GalleryHooks;

  // Sem "parameter properties": mantém o arquivo legível também para o executor de testes do Node.
  constructor(root: HTMLElement, sizer: HTMLElement, loader: ThumbLoader, hooks: GalleryHooks) {
    this.root = root;
    this.sizer = sizer;
    this.loader = loader;
    this.hooks = hooks;

    root.addEventListener("scroll", () => this.schedule(), { passive: true });
    new ResizeObserver(() => {
      this.relayout();
      this.schedule();
    }).observe(root);
    sizer.addEventListener("click", (e) => {
      const i = this.indexFrom(e.target);
      if (i >= 0) this.hooks.onSelect(i);
    });
    sizer.addEventListener("dblclick", (e) => {
      const i = this.indexFrom(e.target);
      if (i >= 0) this.hooks.onOpen(i);
    });
  }

  get columns(): number {
    return this.layout.cols;
  }

  /** Quantas linhas cabem numa "página" (para PageUp e PageDown). */
  get pageRows(): number {
    return Math.max(1, Math.floor(this.root.clientHeight / TILE_H) - 1);
  }

  setItems(entries: Entry[], dir: string, separator: string, selected: number): void {
    this.entries = entries;
    this.dir = dir;
    this.separator = separator;
    this.selected = selected;
    this.version += 1;
    this.relayout();
    this.root.scrollTop = 0;
    if (selected >= 0) this.revealSelected();
    this.render();
  }

  setSelected(index: number, reveal: boolean): void {
    this.selected = index;
    if (reveal) this.revealSelected();
    this.render();
  }

  moveSelection(current: number, key: GridKey): number {
    return moveGridSelection(current, key, this.layout.cols, this.pageRows, this.entries.length);
  }

  /** Recalcula colunas e altura quando muda a largura da janela ou a lista. */
  relayout(): void {
    this.layout = gridLayout(this.root.clientWidth, TILE_W, TILE_H, this.entries.length, PAD);
    this.sizer.style.height = `${this.layout.height}px`;
  }

  render(): void {
    const { start, end } = gridRange(
      this.root.scrollTop,
      this.root.clientHeight,
      TILE_H,
      this.layout.cols,
      this.entries.length,
      OVERSCAN_ROWS,
    );
    const count = end - start;
    while (this.pool.length < count) {
      const view = this.createTile();
      this.pool.push(view);
      this.sizer.append(view.el);
    }
    this.pool.forEach((view, slot) => {
      const entry = slot < count ? this.entries[start + slot] : undefined;
      if (entry) this.show(view, entry, start + slot);
      else this.hide(view);
    });
    if (this.selected >= 0) this.root.setAttribute("aria-activedescendant", `tile-${this.selected}`);
    else this.root.removeAttribute("aria-activedescendant");
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private revealSelected(): void {
    if (this.selected < 0) return;
    const row = Math.floor(this.selected / this.layout.cols);
    this.root.scrollTop = scrollTopToReveal(row, TILE_H, this.root.clientHeight, this.root.scrollTop);
  }

  private indexFrom(target: EventTarget | null): number {
    const tile = (target as HTMLElement | null)?.closest<HTMLElement>(".tile");
    return tile?.dataset.index === undefined ? -1 : Number(tile.dataset.index);
  }

  private createTile(): TileView {
    const el = document.createElement("div");
    el.className = "tile";
    el.setAttribute("role", "option");
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    const glyph = document.createElement("span");
    glyph.className = "glyph";
    glyph.setAttribute("aria-hidden", "true");
    const canvas = document.createElement("canvas");
    canvas.hidden = true;
    thumb.append(glyph, canvas);
    const name = document.createElement("div");
    name.className = "tname";
    el.append(thumb, name);
    return { el, glyph, canvas, name, bound: null, version: -1, key: "", timer: 0, cancel: null };
  }

  private hide(view: TileView): void {
    this.unbind(view);
    view.el.hidden = true;
  }

  private unbind(view: TileView): void {
    window.clearTimeout(view.timer);
    view.cancel?.();
    view.cancel = null;
    view.key = "";
    view.bound = null;
  }

  private show(view: TileView, entry: Entry, index: number): void {
    const { x, y } = gridPosition(index, this.layout.cols, TILE_W, TILE_H, this.layout.offsetX, PAD / 2);
    const el = view.el;
    el.hidden = false;
    el.style.transform = `translate(${x + TILE_GAP / 2}px, ${y + TILE_GAP / 2}px)`;
    el.dataset.index = String(index);
    el.id = `tile-${index}`;
    el.classList.toggle("selected", index === this.selected);
    el.setAttribute("aria-selected", String(index === this.selected));
    el.setAttribute("aria-posinset", String(index + 1));
    el.setAttribute("aria-setsize", String(this.entries.length));

    // Mesma entrada e mesma lista: só posição e seleção mudaram (o caso comum ao rolar).
    if (view.bound === entry && view.version === this.version) return;
    this.unbind(view);
    view.bound = entry;
    view.version = this.version;

    const isDir = entry.kind === "dir";
    el.classList.toggle("dir", isDir);
    el.classList.toggle("dim", entry.hidden);
    // textContent: nomes de arquivo são dados não confiáveis; nunca vão para innerHTML.
    view.name.textContent = entry.isLink ? `${entry.name} ↪` : entry.name;
    el.title = entry.kind === "file" && entry.size !== null ? `${entry.name}\n${formatSize(entry.size)}` : entry.name;
    this.showGlyph(view, isDir ? "📁" : entry.kind === "file" ? "📄" : "▫️");

    if (entry.kind === "file" && isThumbnailable(entry.name)) this.loadThumbnail(view, entry);
  }

  private showGlyph(view: TileView, glyph: string): void {
    view.glyph.textContent = glyph;
    view.glyph.hidden = false;
    view.canvas.hidden = true;
  }

  private draw(view: TileView, bitmap: ImageBitmap): void {
    const canvas = view.canvas;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    canvas.hidden = false;
    view.glyph.hidden = true;
  }

  private loadThumbnail(view: TileView, entry: Entry): void {
    const path = joinPath(this.dir, entry.name, this.separator);
    const key = thumbKey(path, entry.modifiedMs, entry.size);
    view.key = key;

    const cached = this.loader.peek(key);
    if (cached) return this.draw(view, cached);
    if (cached === null) return; // já se sabe que não há miniatura: fica o ícone

    view.timer = window.setTimeout(() => {
      view.cancel = this.loader.request(key, path, (bitmap) => {
        // O tile pode ter sido reaproveitado para outro arquivo enquanto a miniatura carregava.
        if (bitmap && view.key === key) this.draw(view, bitmap);
      });
    }, REQUEST_DELAY_MS);
  }
}
