/** Lado (em pixels) pedido ao sistema: cobre tiles de ~130 px em telas com escala até 150%. */
export const THUMB_PX = 192;

/** Chave de cache: se o arquivo mudar (data ou tamanho), a miniatura antiga deixa de valer. */
export function thumbKey(path: string, modifiedMs: number | null, size: number | null): string {
  return `${path}|${modifiedMs ?? ""}|${size ?? ""}|${THUMB_PX}`;
}

/**
 * O núcleo responde com 8 bytes (largura e altura, u32 little-endian) e depois os pixels RGBA.
 * Valida o tamanho antes de montar a imagem: uma resposta truncada não pode virar lixo na tela.
 */
export function decodeThumbnail(buf: ArrayBuffer): {
  width: number;
  height: number;
  pixels: Uint8ClampedArray<ArrayBuffer>;
} {
  if (buf.byteLength < 8) throw new Error("miniatura truncada");
  const view = new DataView(buf);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  // Compara em `number` (sem multiplicar em 32 bits): largura e altura vêm de fora.
  if (width === 0 || height === 0 || buf.byteLength !== 8 + width * height * 4) {
    throw new Error("miniatura com tamanho inconsistente");
  }
  return { width, height, pixels: new Uint8ClampedArray(buf, 8, width * height * 4) };
}
