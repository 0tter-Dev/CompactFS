import { Channel, invoke } from "@tauri-apps/api/core";

export type EntryKind = "dir" | "file" | "other";

export interface Entry {
  name: string;
  kind: EntryKind;
  size: number | null;
  modifiedMs: number | null;
  hidden: boolean;
  isLink: boolean;
  /** Só nos resultados da busca: pasta onde o item está (caminho completo). */
  dir?: string;
  /** Só nos resultados da busca: `dir` relativo à pasta onde a busca começou (calculado no frontend). */
  relDir?: string;
}

export interface Crumb {
  name: string;
  path: string;
}

export interface Listing {
  path: string;
  parent: string | null;
  breadcrumbs: Crumb[];
  separator: string;
  entries: Entry[];
  skipped: number;
  elapsedMs: number;
}

export type DriveKind = "removable" | "fixed" | "network" | "optical" | "ram" | "unknown";

export interface Drive {
  path: string;
  label: string | null;
  kind: DriveKind;
  ready: boolean;
  totalBytes: number | null;
  freeBytes: number | null;
}

export type ErrorCode = "notFound" | "accessDenied" | "notADirectory" | "deviceUnavailable" | "other";

export interface BrowseError {
  code: ErrorCode;
  message: string;
}

export interface AppInfo {
  name: string;
  version: string;
  startupMs: number;
}

export const appInfo = (): Promise<AppInfo> => invoke<AppInfo>("app_info");

export interface TextContent {
  text: string;
  encoding: string;
  truncated: boolean;
  totalBytes: number;
}

export type ViewErrorCode = "notFound" | "accessDenied" | "notAFile" | "binary" | "blocked" | "other";

export interface ViewError {
  code: ViewErrorCode;
  message: string;
}

/** Libera o arquivo para o protocolo de arquivos (imagem, vídeo, áudio e PDF); o escopo começa vazio. */
export const allowView = (path: string): Promise<void> => invoke<void>("allow_view", { path });

export const readText = (path: string): Promise<TextContent> => invoke<TextContent>("read_text", { path });

/** Abre no app padrão do sistema (o núcleo recusa programas, scripts, atalhos e macros). */
export const openDefault = (path: string): Promise<void> => invoke<void>("open_default", { path });

/** Endereço do arquivo no protocolo de arquivos; só funciona depois de `allowView`. */
export { convertFileSrc } from "@tauri-apps/api/core";

export function toViewError(err: unknown): ViewError {
  if (typeof err === "object" && err !== null && "message" in err) {
    const { code, message } = err as Partial<ViewError>;
    if (typeof message === "string") return { code: code ?? "other", message };
  }
  return { code: "other", message: String(err) };
}

export type SearchEvent =
  | { type: "hits"; hits: Entry[] }
  | { type: "progress"; scannedDirs: number; scannedEntries: number }
  | { type: "done"; summary: SearchSummary };

export interface SearchSummary {
  scannedDirs: number;
  scannedEntries: number;
  matches: number;
  skippedDirs: number;
  truncated: boolean;
  cancelled: boolean;
  elapsedMs: number;
}

/**
 * Busca por nome na pasta e subpastas. Os resultados chegam em lotes por `onEvent` enquanto a busca
 * anda; a promessa resolve com o resumo. Uma busca nova cancela a anterior no núcleo.
 */
export function searchNames(
  root: string,
  query: string,
  showHidden: boolean,
  onEvent: (event: SearchEvent) => void,
): Promise<SearchSummary> {
  const channel = new Channel<SearchEvent>();
  channel.onmessage = onEvent;
  return invoke<SearchSummary>("search_names", { root, query, showHidden, onEvent: channel });
}

export const cancelSearch = (): Promise<void> => invoke<void>("cancel_search");

export const listDrives = (): Promise<Drive[]> => invoke<Drive[]>("list_drives");

export const listDir = (path: string): Promise<Listing> => invoke<Listing>("list_dir", { path });

/** Para onde o texto digitado na barra de endereço aponta (só consulta metadados). */
export type Resolved =
  | { kind: "computer" }
  | { kind: "dir"; path: string }
  | { kind: "file"; path: string; parent: string; name: string };

/** `base` é a pasta aberta, usada só para caminhos relativos como `..\outra`. */
export const resolvePath = (input: string, base: string | null): Promise<Resolved> =>
  invoke<Resolved>("resolve_path", { input, base });

/** O núcleo rejeita com `{ code, message }`; qualquer outra coisa vira um erro genérico. */
export function toBrowseError(err: unknown): BrowseError {
  if (typeof err === "object" && err !== null && "message" in err) {
    const { code, message } = err as Partial<BrowseError>;
    if (typeof message === "string") return { code: code ?? "other", message };
  }
  return { code: "other", message: String(err) };
}
