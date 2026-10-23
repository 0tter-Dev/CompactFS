import { extensionOf } from "./file-types.ts";

export type ViewerKind = "text" | "markdown" | "image" | "pdf" | "video" | "audio";

/**
 * Tipos que o app mostra por conta própria: o que o WebView reproduz nativamente (imagem, vídeo,
 * áudio e PDF) mais texto e markdown. O resto (Office, TIFF, HEIC...) fica para "abrir no app padrão".
 */
const KINDS: Record<string, ViewerKind> = {};

function register(kind: ViewerKind, extensions: string[]): void {
  for (const ext of extensions) KINDS[ext] = kind;
}

register("markdown", ["md", "markdown", "mdown", "mkd"]);
register("image", ["jpg", "jpeg", "jpe", "jfif", "png", "gif", "bmp", "webp", "avif", "ico", "svg"]);
register("pdf", ["pdf"]);
register("video", ["mp4", "m4v", "webm", "mov", "mkv", "ogv"]);
register("audio", ["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "weba"]);
register("text", [
  "txt", "text", "log", "csv", "tsv", "json", "jsonl", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf",
  "properties", "env", "gitignore", "srt", "vtt", "sql", "html", "htm", "css", "js", "mjs", "ts", "tsx",
  "jsx", "py", "rs", "go", "java", "kt", "c", "h", "cpp", "hpp", "cs", "rb", "php", "sh", "bat", "cmd",
  "ps1", "lua", "swift", "tex", "rst", "nfo",
]);

export function viewerKindOf(name: string): ViewerKind | null {
  const ext = extensionOf(name);
  return Object.prototype.hasOwnProperty.call(KINDS, ext) ? (KINDS[ext] as ViewerKind) : null;
}

/** Tipos cujo conteúdo vem do protocolo de arquivos (precisam de `allow_view` antes). */
export function usesAssetProtocol(kind: ViewerKind): boolean {
  return kind === "image" || kind === "pdf" || kind === "video" || kind === "audio";
}
