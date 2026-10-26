import {
  appInfo,
  listDir,
  cancelSearch,
  listDrives,
  openDefault,
  requestStorageAccess,
  searchNames,
  storageAccess,
  toBrowseError,
  toViewError,
  type BrowseError,
  type Drive,
  type DriveKind,
  type Entry,
  type Listing,
  type SearchEvent,
  type SearchSummary,
} from "./api.ts";
import { needsAccessPrompt } from "./access-model.ts";
import { driveTitle } from "./drive-model.ts";
import { formatCount, formatDate, formatSize, joinPath, plural } from "./format.ts";
import { Gallery } from "./gallery.ts";
import { lastSegment, relativeDir, searchStatus, shouldAutoSearch } from "./search-model.ts";
import { ThumbLoader } from "./thumbs.ts";
import { Viewer, type ViewerItem } from "./viewer.ts";
import { viewerKindOf } from "./viewer-kind.ts";
import { moveSelection, scrollTopToReveal, visibleRange, type GridKey, type NavKey } from "./viewport.ts";
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
  accessBanner: $<HTMLElement>("access-banner"),
  accessAllow: $<HTMLButtonElement>("access-allow"),
  showHidden: $<HTMLInputElement>("show-hidden"),
  main: $<HTMLElement>("main"),
  computer: $<HTMLElement>("computer"),
  folder: $<HTMLElement>("folder"),
  columns: $<HTMLElement>("columns"),
  viewGrid: $<HTMLButtonElement>("view-grid"),
  viewList: $<HTMLButtonElement>("view-list"),
  list: $<HTMLElement>("list"),
  sizer: $<HTMLElement>("sizer"),
  grid: $<HTMLElement>("grid"),
  gridSizer: $<HTMLElement>("grid-sizer"),
  message: $<HTMLElement>("message"),
  viewer: $<HTMLElement>("viewer"),
  viewerClose: $<HTMLButtonElement>("viewer-close"),
  viewerTitle: $<HTMLElement>("viewer-title"),
  viewerPos: $<HTMLElement>("viewer-pos"),
  viewerPrev: $<HTMLButtonElement>("viewer-prev"),
  viewerNext: $<HTMLButtonElement>("viewer-next"),
  viewerRaw: $<HTMLButtonElement>("viewer-raw"),
  viewerOpen: $<HTMLButtonElement>("viewer-open"),
  viewerBody: $<HTMLElement>("viewer-body"),
  viewerNote: $<HTMLElement>("viewer-note"),
  search: $<HTMLInputElement>("search"),
  searchBar: $<HTMLElement>("search-bar"),
  searchInfo: $<HTMLElement>("search-info"),
  searchWhere: $<HTMLElement>("search-where"),
  searchReveal: $<HTMLButtonElement>("search-reveal"),
  searchClose: $<HTMLButtonElement>("search-close"),
  searchEmpty: $<HTMLElement>("search-empty"),
  statusMain: $<HTMLElement>("status-main"),
  statusApp: $<HTMLElement>("status-app"),
};

type ViewMode = "grid" | "list";
const VIEW_KEY = "cfs.viewMode";

// localStorage pode lançar (janela privada, dados bloqueados): a escolha é só uma conveniência.
function loadViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function saveViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_KEY, mode);
  } catch {
    // sem persistência: o app continua funcionando
  }
}

let viewMode: ViewMode = loadViewMode();
const loader = new ThumbLoader();
const gallery = new Gallery(els.grid, els.gridSizer, loader, {
  onSelect: (index) => setSelected(index, false),
  onOpen: (index) => {
    const entry = visible[index];
    if (entry) void open(entry);
  },
});

const viewer = new Viewer(
  {
    root: els.viewer,
    close: els.viewerClose,
    title: els.viewerTitle,
    position: els.viewerPos,
    prev: els.viewerPrev,
    next: els.viewerNext,
    raw: els.viewerRaw,
    openDefault: els.viewerOpen,
    body: els.viewerBody,
    note: els.viewerNote,
  },
  {
    onClose: (index) => {
      show("folder");
      if (index >= 0) setSelected(index, true);
      activeScroller().focus({ preventScroll: true });
    },
    onMessage: (text) => flashStatus(text),
  },
);

/** Busca em andamento ou concluída. Os resultados ficam aqui; a pasta (`listing`) continua guardada. */
interface SearchState {
  query: string;
  root: string;
  results: Entry[];
  scannedDirs: number;
  /** `null` enquanto a busca ainda anda. */
  summary: SearchSummary | null;
  /** Item que estava selecionado na pasta, para devolver a seleção ao limpar a busca. */
  savedSelectedName: string | null;
}

let search: SearchState | null = null;
let searchToken = 0;
let searchTimer: number | undefined;

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

function show(view: "computer" | "folder" | "message" | "viewer"): void {
  // Qualquer tela que não seja o visualizador o encerra: um vídeo escondido continuaria tocando e
  // prenderia o arquivo (e o disco não poderia ser ejetado).
  if (view !== "viewer") viewer.dismiss();
  els.computer.hidden = view !== "computer";
  els.folder.hidden = view !== "folder";
  els.message.hidden = view !== "message";
  els.viewer.hidden = view !== "viewer";
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
  const inFolder = current?.kind === "dir";
  els.search.disabled = !inFolder;
  els.search.placeholder = inFolder ? "Buscar (Ctrl+F)" : "Abra uma pasta para buscar";
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
  const title = document.createElement("span");
  title.className = "drive-title";
  title.textContent = driveTitle(d.path, d.label);
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
  loader.clearPending();
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
  const source = search ? search.results : (listing?.entries ?? []);
  visible = showHidden ? source : source.filter((e) => !e.hidden);
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
  const label = entry.isLink ? `${entry.name} ↪` : entry.name;
  if (entry.relDir === undefined) {
    name.textContent = label;
  } else {
    // Resultado de busca: o nome e, em cinza, a pasta de onde ele veio.
    const where = document.createElement("span");
    where.className = "rel";
    where.textContent = entry.relDir;
    name.replaceChildren(document.createTextNode(label), where);
  }
  name.title = entry.relDir === undefined ? entry.name : `${entry.name}\n${entry.relDir || "(pasta da busca)"}`;
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
  if (search) {
    els.statusMain.textContent = searchStatus({
      query: search.query,
      matches: search.results.length,
      scannedDirs: search.scannedDirs,
      summary: search.summary,
    });
    return;
  }
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

/** Mostra a lista ou a galeria, conforme o modo escolhido. */
function applyViewMode(): void {
  const grid = viewMode === "grid";
  els.grid.hidden = !grid;
  els.list.hidden = grid;
  els.columns.hidden = grid;
  els.viewGrid.setAttribute("aria-pressed", String(grid));
  els.viewList.setAttribute("aria-pressed", String(!grid));
}

function activeScroller(): HTMLElement {
  return viewMode === "grid" ? els.grid : els.list;
}

/** (Re)preenche a visão ativa com `visible`, rolando até o item selecionado. */
function showItems(): void {
  if (!listing) return;
  if (viewMode === "grid") {
    gallery.setItems(visible, listing.path, listing.separator, selected);
    return;
  }
  els.sizer.style.height = `${visible.length * ROW_HEIGHT}px`;
  els.list.scrollTop = 0;
  if (selected >= 0) els.list.scrollTop = scrollTopToReveal(selected, ROW_HEIGHT, els.list.clientHeight, 0);
  renderRows();
}

function setSelected(index: number, reveal: boolean): void {
  selected = index;
  updateSearchBar();
  if (viewMode === "grid") {
    gallery.setSelected(index, reveal);
    return;
  }
  if (reveal && index >= 0) {
    els.list.scrollTop = scrollTopToReveal(index, ROW_HEIGHT, els.list.clientHeight, els.list.scrollTop);
  }
  renderRows();
}

function setViewMode(mode: ViewMode): void {
  if (mode === viewMode) return;
  viewMode = mode;
  saveViewMode(mode);
  applyViewMode();
  if (listing && !els.folder.hidden) {
    showItems();
    activeScroller().focus({ preventScroll: true });
  }
}

function renderFolder(next: Listing, selectName: string | null): void {
  listing = next;
  applyFilter();
  loader.clearPending();
  applyViewMode();
  show("folder");
  const found = selectName === null ? -1 : visible.findIndex((e) => e.name === selectName);
  selected = found >= 0 ? found : visible.length > 0 ? 0 : -1;
  showItems();
  updateFolderStatus();
  activeScroller().focus({ preventScroll: true });
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
  endSearch(false);
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

function pathOf(entry: Entry): string {
  return listing ? joinPath(entry.dir ?? listing.path, entry.name, listing.separator) : entry.name;
}

/** Abre o visualizador no arquivo, com a lista dos arquivos visualizáveis da pasta para ir e voltar. */
function openViewer(entry: Entry): void {
  const items: ViewerItem[] = [];
  let pos = -1;
  visible.forEach((e, index) => {
    const kind = e.kind === "file" ? viewerKindOf(e.name) : null;
    if (!kind) return;
    if (e === entry) pos = items.length;
    items.push({ path: pathOf(e), name: e.name, kind, index, size: e.size });
  });
  if (pos < 0) return;
  show("viewer");
  viewer.open(items, pos);
}

async function openInDefaultApp(entry: Entry): Promise<void> {
  if (!listing || entry.kind !== "file") return;
  try {
    await openDefault(pathOf(entry));
    flashStatus(`Abrindo ${entry.name} no app padrão…`);
  } catch (error) {
    flashStatus(toViewError(error).message);
  }
}

/** Ctrl+Enter: abre o arquivo selecionado no app padrão, sem passar pelo visualizador. */
function openWithDefaultShortcut(e: KeyboardEvent): boolean {
  if (e.key !== "Enter" || !e.ctrlKey || e.altKey || e.metaKey) return false;
  const entry = visible[selected];
  if (entry?.kind === "file") {
    e.preventDefault();
    void openInDefaultApp(entry);
  }
  return true;
}

async function open(entry: Entry): Promise<void> {
  if (!listing) return;
  if (entry.kind === "dir") {
    await go({ kind: "dir", path: pathOf(entry) });
  } else if (entry.kind === "file" && viewerKindOf(entry.name)) {
    openViewer(entry);
  } else {
    // Sem visualizador próprio (Office, TIFF...): o app padrão do sistema abre; programas e scripts, nunca.
    await openInDefaultApp(entry);
  }
}

// ---------- busca ----------

/** Mostra ou esconde a faixa de resultados e mantém o texto dela em dia. */
function updateSearchBar(): void {
  const active = search !== null;
  els.searchBar.hidden = !active;
  if (!search) {
    els.searchEmpty.hidden = true;
    return;
  }
  // Só o nome da pasta na faixa (o caminho completo vai no tooltip): um caminho longo empurrava os
  // botões para fora da janela.
  els.searchInfo.textContent = `Busca em ${lastSegment(search.root)}`;
  els.searchInfo.title = search.root;
  const entry = visible[selected];
  els.searchWhere.textContent = entry?.dir
    ? `Pasta do item: ${entry.relDir ? entry.relDir : "(a própria pasta da busca)"}`
    : "";
  els.searchWhere.title = entry?.dir ?? "";
  els.searchReveal.disabled = !entry?.dir;
  const finishedEmpty = search.summary !== null && visible.length === 0;
  els.searchEmpty.hidden = !finishedEmpty;
  if (finishedEmpty) {
    els.searchEmpty.textContent = `Nenhum item com “${search.query}” no nome nesta pasta e nas subpastas. Tente menos palavras${showHidden ? "" : " ou ative “Mostrar ocultos”"}.`;
  }
}

/** Atualiza a visão com os resultados que acabaram de chegar, sem perder a rolagem. */
function refreshResultsView(first: boolean): void {
  if (first) {
    showItems();
    return;
  }
  if (viewMode === "grid") {
    gallery.updateItems(visible, selected);
  } else {
    els.sizer.style.height = `${visible.length * ROW_HEIGHT}px`;
    renderRows();
  }
}

function onSearchEvent(token: number, event: SearchEvent): void {
  if (token !== searchToken || !search || !listing) return;
  if (event.type === "progress") {
    search.scannedDirs = event.scannedDirs;
    updateFolderStatus();
    return;
  }
  if (event.type === "done") {
    // O fim chega pelo mesmo canal dos resultados: todos os lotes já foram recebidos.
    search.summary = event.summary;
    updateFolderStatus();
    updateSearchBar();
    return;
  }
  for (const hit of event.hits) {
    hit.relDir = relativeDir(search.root, hit.dir ?? search.root, listing.separator);
    search.results.push(hit);
  }
  const first = visible.length === 0;
  applyFilter();
  if (selected < 0 && visible.length > 0) selected = 0;
  refreshResultsView(first);
  updateFolderStatus();
  updateSearchBar();
}

function startSearch(text: string): void {
  if (!listing || current?.kind !== "dir") return;
  const query = text.trim();
  if (query === "") {
    endSearch(true);
    return;
  }
  const token = ++searchToken;
  const saved = search ? search.savedSelectedName : selected >= 0 ? (visible[selected]?.name ?? null) : null;
  search = { query, root: listing.path, results: [], scannedDirs: 0, summary: null, savedSelectedName: saved };
  loader.clearPending();
  applyFilter();
  selected = -1;
  showItems();
  updateFolderStatus();
  updateSearchBar();
  searchNames(listing.path, query, showHidden, (event) => onSearchEvent(token, event))
    .then((summary) => {
      // A resposta do comando pode chegar ANTES dos últimos lotes do canal, então ela não encerra a
      // busca sozinha (o evento "done" faz isso). Só entra como reserva, se o evento nunca vier.
      window.setTimeout(() => {
        if (token !== searchToken || !search || search.summary !== null) return;
        search.summary = summary;
        updateFolderStatus();
        updateSearchBar();
      }, 3000);
    })
    .catch((error: unknown) => {
      if (token !== searchToken || !search) return;
      setStatus(`Erro na busca: ${toBrowseError(error).message}`);
    });
}

/** Encerra a busca. Com `restore`, volta a mostrar a pasta e a seleção de antes. */
function endSearch(restore: boolean): void {
  window.clearTimeout(searchTimer);
  const had = search !== null;
  const savedName = search?.savedSelectedName ?? null;
  if (had) {
    searchToken += 1; // descarta lotes e o resumo que ainda estejam a caminho
    void cancelSearch().catch(() => {});
    search = null;
  }
  els.search.value = "";
  updateSearchBar();
  if (had && restore && listing) {
    applyFilter();
    const found = savedName === null ? -1 : visible.findIndex((e) => e.name === savedName);
    selected = found >= 0 ? found : visible.length > 0 ? 0 : -1;
    showItems();
    updateFolderStatus();
    activeScroller().focus({ preventScroll: true });
  }
}

/** Mostra o resultado selecionado dentro da pasta dele, com ele selecionado. */
function revealResult(): void {
  const entry = visible[selected];
  if (!search || !entry?.dir) return;
  void go({ kind: "dir", path: entry.dir }, { selectName: entry.name });
}

function focusSearch(): void {
  if (els.search.disabled) {
    flashStatus("Abra uma pasta para buscar.");
    return;
  }
  els.search.focus();
  els.search.select();
}

/** Esc limpa a busca; Shift+Enter mostra o resultado na pasta dele. Devolve `true` se tratou a tecla. */
function searchShortcut(e: KeyboardEvent): boolean {
  if (!search) return false;
  if (e.key === "Escape") {
    e.preventDefault();
    endSearch(true);
    return true;
  }
  if (e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    revealResult();
    return true;
  }
  return false;
}

// ---------- acesso a todos os arquivos (Android) ----------

let accessMissing = false;

/** Mostra a faixa de pedido quando falta a permissão; ao ser concedida, recarrega o local atual. */
async function refreshStorageAccess(): Promise<void> {
  let missing: boolean;
  try {
    missing = needsAccessPrompt(await storageAccess());
  } catch {
    return; // sem a informação, não incomoda o usuário
  }
  els.accessBanner.hidden = !missing;
  if (accessMissing && !missing) void refresh();
  accessMissing = missing;
}

els.accessAllow.addEventListener("click", () => {
  requestStorageAccess().catch((e) => flashStatus(toBrowseError(e).message));
});
// A tela de permissões do sistema devolve o foco ao app: é a hora de conferir de novo.
window.addEventListener("focus", () => void refreshStorageAccess());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshStorageAccess();
});

// ---------- eventos ----------

els.search.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  const text = els.search.value;
  if (text.trim() === "") {
    endSearch(true);
  } else if (shouldAutoSearch(text)) {
    searchTimer = window.setTimeout(() => startSearch(text), 300);
  }
});

els.search.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    window.clearTimeout(searchTimer);
    startSearch(els.search.value);
  } else if (e.key === "Escape") {
    e.preventDefault();
    endSearch(true);
    activeScroller().focus({ preventScroll: true });
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    activeScroller().focus({ preventScroll: true });
  }
});

els.searchReveal.addEventListener("click", () => revealResult());
els.searchClose.addEventListener("click", () => endSearch(true));

els.back.addEventListener("click", () => void back());
els.forward.addEventListener("click", () => void forward());
els.up.addEventListener("click", () => void up());
els.refresh.addEventListener("click", () => void refresh());

els.showHidden.addEventListener("change", () => {
  showHidden = els.showHidden.checked;
  if (!listing) return;
  if (search) {
    startSearch(search.query); // os ocultos mudam o que a busca percorre
    return;
  }
  const keep = selected >= 0 ? (visible[selected]?.name ?? null) : null;
  applyFilter();
  const found = keep === null ? -1 : visible.findIndex((e) => e.name === keep);
  selected = found >= 0 ? found : visible.length > 0 ? 0 : -1;
  showItems();
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

els.viewGrid.addEventListener("click", () => setViewMode("grid"));
els.viewList.addEventListener("click", () => setViewMode("list"));

const NAV_KEYS = new Set<string>(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);
const GRID_KEYS = new Set<string>([...NAV_KEYS, "ArrowLeft", "ArrowRight"]);

els.grid.addEventListener("keydown", (e) => {
  if (searchShortcut(e) || openWithDefaultShortcut(e) || e.altKey || e.ctrlKey || e.metaKey) return;
  if (GRID_KEYS.has(e.key)) {
    e.preventDefault();
    setSelected(gallery.moveSelection(selected, e.key as GridKey), true);
  } else if (e.key === "Enter") {
    const entry = visible[selected];
    if (entry) {
      e.preventDefault();
      void open(entry);
    }
  }
});

els.list.addEventListener("keydown", (e) => {
  if (searchShortcut(e) || openWithDefaultShortcut(e) || e.altKey || e.ctrlKey || e.metaKey) return;
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
  if (viewer.isOpen) {
    if (viewer.handleKey(e)) e.preventDefault();
    return;
  }
  const typing = e.target instanceof HTMLInputElement && e.target.type === "text";
  if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "f") {
    e.preventDefault();
    focusSearch();
  } else if (e.key === "F5") {
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

applyViewMode();
void go({ kind: "computer" });
void refreshStorageAccess();
