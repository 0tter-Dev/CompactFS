/** Extensões para as quais vale pedir miniatura ao sistema (imagens, vídeo e PDF). */
const THUMBNAIL_EXTENSIONS = new Set([
  // imagens
  "jpg", "jpeg", "jpe", "jfif", "png", "gif", "bmp", "webp", "tif", "tiff", "ico", "heic", "heif", "avif",
  // fotos RAW comuns (dependem de codec instalado)
  "dng", "cr2", "cr3", "nef", "arw", "orf", "rw2",
  // vídeo
  "mp4", "m4v", "mov", "avi", "wmv", "mkv", "webm", "mpg", "mpeg", "3gp",
  // documentos
  "pdf",
]);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  // Sem ponto, ou só um ponto inicial (".gitignore"): não há extensão.
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export function isThumbnailable(name: string): boolean {
  return THUMBNAIL_EXTENSIONS.has(extensionOf(name));
}
