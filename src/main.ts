import {
  appInfo,
  listDir,
  listDrives,
  toBrowseError,
  type BrowseError,
  type Drive,
  type DriveKind,
  type Entry,
  type Listing,
} from "./api.ts";
import { formatCount, formatDate, formatSize, joinPath } from "./format.ts";
import { moveSelection, scrollTopToReveal, visibleRange, type NavKey } from "./viewport.ts";
import "./style.css";

const ROW_HEIGHT = 28;
const OVERSCAN = 6;
const LOADING_DELAY_MS = 150;

type Location = { kind: "computer" } | { kind: "dir"; path: string };

/** Uma linha reutilizável da lista virtual, com referências diretas às suas células. */
interface RowView {
  row: HTMLElement;
  icon: HTMLElement;
  name: HTMLElement;
  date: HTMLElement;
  size: HTMLElement;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento #${id} ausente`);
  return el as T;
};

const els = {
  back: $<HTMLButtonElement>("back"),
  forward: $<HTMLButtonElement>("forward"),
  up: $<HTMLButtonElement>("up"),
  refresh: $<HTMLButtonElement>("refresh"),
  crumbs: $<HTMLElement>("crumbs"),
  showHidden: $<HTMLInputElement>("show-hidden"),
  main: $<HTMLElement>("main"),
  computer: $<HTMLElement>("computer"),
  folder: $<HTMLElement>("folder"),
  list: $<HTMLElement>("list"),
  sizer: $<HTMLElement>("sizer"),
  message: $<HTMLElement>("message"),
  statusMain: $<HTMLElement>("status-main"),
  statusApp: $<HTMLElement>("status-app"),
};

let current: Location | null = null;
let listing: Listing | null = null;
let visible: Entry[] = [];
let selected = -1;
let showHidden = false;
let requestId = 0;
const history: Location[] = [];
let historyIndex = -1;
const pool: RowView[] = [];
let tempStatusTimer: number | undefined;

// ---------- utilidades de interface ----------

function show(view: "computer" | "folder" | "message"): void {
  els.computer.hidden = view !== "computer";
  els.folder.hidden = view !== "folder";
  els.message.hidden = view !== "message";
}

function setStatus(text: string): void {
  window.clearTimeout(tempStatusTimer);
  els.statusMain.textContent = text;
}

/** Mensagem passageira na barra de status; depois volta ao texto da pasta. */
function flashStatus(text: string): void {
  setStatus(text);
  tempStatusTimer = window.setTimeout(updateFolderStatus, 3500);
}

function updateNavButtons(): void {
  els.back.disabled = historyIndex <= 0;
  els.forward.disabled = historyIndex >= history.length - 1;
  els.up.disabled = current === null || current.kind === "computer";
}

function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

// ---------- trilha de navegação ----------

function crumbButton(label: string, onClick: (() => void) | null, title?: string): HTMLElement {
  const btn = document.createElement(onClick ? "button" : "span");
  btn.className = "crumb";
  btn.textContent = label;
  if (title) btn.title = title;
  if (onClick) {
    (btn as HTMLButtonElement).type = "button";
    btn.addEventListener("click", onClick);
  } else {
    btn.setAttribute("aria-current", "page");
  }
  return btn;
}

function renderCrumbs(): void {
  const parts: HTMLElement[] = [];
  const atComputer = current?.kind === "computer";
  parts.push(
    crumbButton("Este computador", atComputer ? null : () => void go({ kind: "computer" })),
  );
  if (current?.kind === "dir" && listing) {
    listing.breadcrumbs.forEach((c, i) => {
      const last = i === listing!.breadcrumbs.length - 1;
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = "›";
      sep.setAttribute("aria-hidden", "true");
      parts.push(sep, crumbButton(c.name, last ? null : () => void go({ kind: "dir", path: c.path }), c.path));
    });
  }
  els.crumbs.replaceChildren(...parts);
  // Caminhos longos: o que importa é o fim (a pasta atual), então rola a trilha até lá.
  els.crumbs.scrollLeft = els.crumbs.scrollWidth;
}

// ---------- Este computador ----------

const DRIVE_KIND_LABEL: Record<DriveKind, string> = {
  removable: "Disco removível",
  fixed: "Disco local",
  network: "Unidade de rede",
  optical: "Unidade óptica",
  ram: "Disco virtual",
  unknown: "Disco",
};

const DRIVE_ICON: Record<DriveKind, string> = {
  removable: "🔌",
  fixed: "💽",
  network: "🌐",
  optical: "📀",
  ram: "⚡",
  unknown: "💽",
};

function driveCard(d: Drive): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `drive${d.ready ? "" : " not-ready"}`;
  btn.addEventListener("click", () => void go({ kind: "dir", path: d.path }));

  const icon = document.createElement("span");
  icon.className = "drive-icon";
  icon.textContent = DRIVE_ICON[d.kind];
  icon.setAttribute("aria-hidden", "true");

  const body = document.createElement("span");
  body.className = "drive-body";
  const letter = d.path.replace(/[\\/]+$/, "");
  const title = document.createElement("span");
  title.className = "drive-title";
  title.textContent = d.label ? `${d.label} (${letter})` : letter;
  const sub = document.createElement("span");
  sub.className = "drive-sub";
  body.append(title, sub);

  if (!d.ready) {
    sub.textContent = `${DRIVE_KIND_LABEL[d.kind]} · sem mídia ou sem resposta`;
  } else if (d.totalBytes !== null && d.freeBytes !== null && d.totalBytes > 0) {
    const used = Math.min(100, Math.max(0, ((d.totalBytes - d.freeBytes) / d.totalBytes) * 100));
    sub.textContent = `${DRIVE_KIND_LABEL[d.kind]} · ${formatSize(d.freeBytes)} livres de ${formatSize(d.totalBytes)}`;
    const bar = document.createElement("span");
    bar.className = "drive-bar";
    const fill = document.createElement("span");
    fill.style.width = `${used.toFixed(1)}%`;
    bar.append(fill);
    body.append(bar);
  } else {
    sub.textContent = DRIVE_KIND_LABEL[d.kind];
  }

  btn.append(icon, body);
  return btn;
}

function renderComputer(drives: Drive[]): void {
  // Discos removíveis primeiro: são o foco do app.
  const sorted = [...drives].sort(
    (a, b) => Number(b.kind === "removable") - Number(a.kind === "removable") || a.path.localeCompare(b.path),
  );
  const heading = document.createElement("h1");
  heading.textContent = "Este computador";
  const grid = document.createElement("div");
  grid.className = "drives";
  if (sorted.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nenhum disco encontrado.";
    grid.append(empty);
  } else {
    grid.append(...sorted.map(driveCard));
  }
  els.computer.replaceChildren(heading, grid);
  show("computer");
  listing = null;
  visible = [];
  selected = -1;
  const removable = sorted.filter((d) => d.kind === "removable").length;
  setStatus(
    `${plural(sorted.length, "disco", "discos")}` +
      (removable > 0 ? ` · ${plural(removable, "removível", "removíveis")}` : ""),
  );
  grid.querySelector<HTMLElement>("button")?.focus();
}

// ---------- pasta (lista virtualizada) ----------

function applyFilter(): void {
  visible = listing ? (showHidden ? listing.entries : listing.entries.filter((e) => !e.hidden)) : [];
}

function createRow(): RowView {
  const row = document.createElement("div");
  row.className = "row";
  row.setAttribute("role", "option");
  const cell = (cls: string): HTMLElement => {
    const el = document.createElement("span");
    el.className = `cell ${cls}`;
    return el;
  };
  const icon = cell("icon");
  icon.setAttribute("aria-hidden", "true");
  const name = cell("name");
  const date = cell("date");
  const size = cell("size");
  row.append(icon, name, date, size);
  return { row, icon, name, date, size };
}

function fillRow(view: RowView, entry: Entry, index: number): void {
  const { row, icon, name, date, size } = view;
  const isDir = entry.kind === "dir";
  row.dataset.index = String(index);
  row.id = `row-${index}`;
  row.style.transform = `translateY(${index * ROW_HEIGHT}px)`;
  row.hidden = false;
  row.classList.toggle("dir", isDir);
  row.classList.toggle("dim", entry.hidden);
  row.classList.toggle("selected", index === selected);
  row.setAttribute("aria-selected", String(index === selected));
  row.setAttribute("aria-posinset", String(index + 1));
  row.setAttribute("aria-setsize", String(visible.length));
  icon.textContent = isDir ? "📁" : entry.kind === "file" ? "📄" : "▫️";
  // textContent: nomes de arquivo são dados não confiáveis; nunca vão para innerHTML.
  name.textContent = entry.isLink ? `${entry.name} ↪` : entry.name;
  name.title = entry.name;
  date.textContent = formatDate(entry.modifiedMs);
  size.textContent = entry.kind === "file" && entry.size !== null ? formatSize(entry.size) : "";
}

function renderRows(): void {
  const { start, end } = visibleRange(
    els.list.scrollTop,
    els.list.clientHeight,
    ROW_HEIGHT,
    visible.length,
    OVERSCAN,
  );
  const count = end - start;
  while (pool.length < count) {
    const view = createRow();
    pool.push(view);
    els.sizer.append(view.row);
  }
  pool.forEach((view, slot) => {
    const entry = slot < count ? visible[start + slot] : undefined;
    if (entry) fillRow(view, entry, start + slot);
    else view.row.hidden = true;
  });
  if (selected >= 0) els.list.setAttribute("aria-activedescendant", `row-${selected}`);
  else els.list.removeAttribute("aria-activedescendant");
}

let frame = 0;
function scheduleRender(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    renderRows();
  });
}

function updateFolderStatus(): void {
  if (!listing) return;
  const dirs = visible.filter((e) => e.kind === "dir").length;
  const hiddenCount = listing.entries.length - visible.length;
  const parts = [
    `${plural(visible.length, "item", "itens")} (${plural(dirs, "pasta", "pastas")}, ${plural(visible.length - dirs, "arquivo", "arquivos")})`,
  ];
  if (hiddenCount > 0) parts.push(`${plural(hiddenCount, "oculto não exibido", "ocultos não exibidos")}`);
  if (listing.skipped > 0) parts.push(`${plural(listing.skipped, "item ilegível ignorado", "itens ilegíveis ignorados")}`);
  parts.push(`listado em ${formatCount(listing.elapsedMs)} ms`);
  els.statusMain.textContent = parts.join(" · ");
}

function setSelected(index: number, reveal: boolean): void {
  selected = index;
  if (reveal && index >= 0) {
    els.list.scrollTop = scrollTopToReveal(index, ROW_HEIGHT, els.list.clientHeight, els.list.scrollTop);
  }
  renderRows();
}

function renderFolder(next: Listing, selectName: string | null): void {
  listing = next;
  applyFilter();
  show("folder");
  els.sizer.style.height = `${visible.length * ROW_HEIGHT}px`;
  els.list.scrollTop = 0;
  const found = selectName === null ? -1 : visible.findIndex((e) => e.name === selectName);
  selected = found >= 0 ? found : visible.length > 0 ? 0 : -1;
  if (selected >= 0) els.list.scrollTop = scrollTopToReveal(selected, ROW_HEIGHT, els.list.clientHeight, 0);
  renderRows();
  updateFolderStatus();
  els.list.focus({ preventScroll: true });
}

function showError(err: BrowseError): void {
  const title = document.createElement("h1");
  title.textContent = "Não foi possível abrir";
  const text = document.createElement("p");
  text.textContent = err.message;
  const actions = document.createElement("div");
  actions.className = "actions";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Tentar novamente";
  retry.addEventListener("click", () => void refresh());
  const home = document.createElement("button");
  home.type = "button";
  home.textContent = "Ir para Este computador";
  home.addEventListener("click", () => void go({ kind: "computer" }));
  actions.append(retry, home);
  els.message.replaceChildren(title, text, actions);
  show("message");
  setStatus("Erro ao abrir a pasta");
  retry.focus();
}

// ---------- navegação ----------

interface NavOptions {
  record?: boolean;
  selectName?: string | null;
}

/** Carrega um local. Devolve `true` se a tela foi atualizada; respostas antigas são descartadas. */
async function load(loc: Location, opts: NavOptions = {}): Promise<boolean> {
  const id = ++requestId;
  const timer = window.setTimeout(() => {
    if (id === requestId) setStatus("Carregando…");
  }, LOADING_DELAY_MS);
  els.main.setAttribute("aria-busy", "true");
  const t0 = performance.now();
  try {
    if (loc.kind === "computer") {
      const drives = await listDrives();
      if (id !== requestId) return false;
      current = loc;
      renderComputer(drives);
    } else {
      const result = await listDir(loc.path);
      if (id !== requestId) return false;
      current = loc;
      renderFolder(result, opts.selectName ?? null);
      renderCrumbs();
      const total = Math.round(performance.now() - t0);
      els.statusMain.textContent += ` (${formatCount(total)} ms no total)`;
    }
    if (loc.kind === "computer") renderCrumbs();
    return true;
  } catch (e) {
    if (id !== requestId) return false;
    showError(toBrowseError(e));
    return false;
  } finally {
    window.clearTimeout(timer);
    if (id === requestId) els.main.removeAttribute("aria-busy");
    updateNavButtons();
  }
}

async function go(loc: Location, opts: NavOptions = {}): Promise<void> {
  const ok = await load(loc, opts);
  if (!ok || opts.record === false) return;
  history.length = historyIndex + 1;
  history.push(loc);
  historyIndex = history.length - 1;
  updateNavButtons();
}

async function back(): Promise<void> {
  const target = history[historyIndex - 1];
  if (!target) return;
  if (await load(target)) {
    historyIndex -= 1;
    updateNavButtons();
  }
}

async function forward(): Promise<void> {
  const target = history[historyIndex + 1];
  if (!target) return;
  if (await load(target)) {
    historyIndex += 1;
    updateNavButtons();
  }
}

async function up(): Promise<void> {
  if (!current || current.kind === "computer") return;
  const crumbs = listing?.breadcrumbs ?? [];
  const childName = crumbs.length > 0 ? crumbs[crumbs.length - 1]!.name : null;
  if (listing?.parent) await go({ kind: "dir", path: listing.parent }, { selectName: childName });
  else await go({ kind: "computer" });
}

async function refresh(): Promise<void> {
  if (!current) return;
  const keep = selected >= 0 ? (visible[selected]?.name ?? null) : null;
  await load(current, { selectName: keep });
}

async function open(entry: Entry): Promise<void> {
  if (!listing) return;
  if (entry.kind === "dir") {
    await go({ kind: "dir", path: joinPath(listing.path, entry.name, listing.separator) });
  } else {
    flashStatus("Abrir e visualizar arquivos ainda não está disponível nesta versão.");
  }
}

// ---------- eventos ----------

els.back.addEventListener("click", () => void back());
els.forward.addEventListener("click", () => void forward());
els.up.addEventListener("click", () => void up());
els.refresh.addEventListener("click", () => void refresh());

els.showHidden.addEventListener("change", () => {
  showHidden = els.showHidden.checked;
  if (!listing) return;
  const keep = selected >= 0 ? (visible[selected]?.name ?? null) : null;
  applyFilter();
  els.sizer.style.height = `${visible.length * ROW_HEIGHT}px`;
  const found = keep === null ? -1 : visible.findIndex((e) => e.name === keep);
  selected = found >= 0 ? found : visible.length > 0 ? 0 : -1;
  renderRows();
  updateFolderStatus();
});

els.list.addEventListener("scroll", scheduleRender, { passive: true });
new ResizeObserver(scheduleRender).observe(els.list);

function rowIndexFrom(target: EventTarget | null): number {
  const row = (target as HTMLElement | null)?.closest<HTMLElement>(".row");
  return row?.dataset.index === undefined ? -1 : Number(row.dataset.index);
}

els.sizer.addEventListener("click", (e) => {
  const i = rowIndexFrom(e.target);
  if (i >= 0) setSelected(i, false);
});

els.sizer.addEventListener("dblclick", (e) => {
  const entry = visible[rowIndexFrom(e.target)];
  if (entry) void open(entry);
});

const NAV_KEYS = new Set<string>(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);

els.list.addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (NAV_KEYS.has(e.key)) {
    e.preventDefault();
    const page = Math.max(1, Math.floor(els.list.clientHeight / ROW_HEIGHT) - 1);
    setSelected(moveSelection(selected, e.key as NavKey, page, visible.length), true);
  } else if (e.key === "Enter") {
    const entry = visible[selected];
    if (entry) {
      e.preventDefault();
      void open(entry);
    }
  }
});

document.addEventListener("keydown", (e) => {
  const typing = e.target instanceof HTMLInputElement && e.target.type === "text";
  if (e.key === "F5") {
    e.preventDefault();
    void refresh();
  } else if (e.altKey && e.key === "ArrowLeft") {
    e.preventDefault();
    void back();
  } else if (e.altKey && e.key === "ArrowRight") {
    e.preventDefault();
    void forward();
  } else if ((e.altKey && e.key === "ArrowUp") || (e.key === "Backspace" && !typing)) {
    e.preventDefault();
    void up();
  }
});

// ---------- início ----------

appInfo()
  .then((info) => {
    els.statusApp.textContent = `${info.name} v${info.version} · interface pronta em ${formatCount(info.startupMs)} ms`;
  })
  .catch((err) => {
    els.statusApp.textContent = `Erro ao iniciar: ${String(err)}`;
  });

void go({ kind: "computer" });
