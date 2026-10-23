import { invoke } from "@tauri-apps/api/core";

export type EntryKind = "dir" | "file" | "other";

export interface Entry {
  name: string;
  kind: EntryKind;
  size: number | null;
  modifiedMs: number | null;
  hidden: boolean;
  isLink: boolean;
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

export const listDrives = (): Promise<Drive[]> => invoke<Drive[]>("list_drives");

export const listDir = (path: string): Promise<Listing> => invoke<Listing>("list_dir", { path });

/** O núcleo rejeita com `{ code, message }`; qualquer outra coisa vira um erro genérico. */
export function toBrowseError(err: unknown): BrowseError {
  if (typeof err === "object" && err !== null && "message" in err) {
    const { code, message } = err as Partial<BrowseError>;
    if (typeof message === "string") return { code: code ?? "other", message };
  }
  return { code: "other", message: String(err) };
}
