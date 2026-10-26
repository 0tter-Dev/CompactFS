/** Largura em pixels de uma página pedida ao núcleo: a da tela vezes a densidade, dentro de limites. */
export function pdfRenderWidth(cssWidth: number, devicePixelRatio: number): number {
  const raw = Math.round(cssWidth * Math.max(1, devicePixelRatio));
  return Math.min(2000, Math.max(200, raw));
}

/** Proporção (largura / altura) de uma página; 1 por segurança se o tamanho vier zerado. */
export function pageRatio(width: number, height: number): number {
  return width > 0 && height > 0 ? width / height : 1;
}

/** Quantas páginas ficam desenhadas ao mesmo tempo: as visíveis e uma folga, para não estourar a memória. */
export const PDF_KEEP_PAGES = 6;

/** Páginas que devem continuar desenhadas: as `keep` mais próximas da página `focus`. */
export function pagesToKeep(focus: number, pages: number, keep: number = PDF_KEEP_PAGES): Set<number> {
  const order = Array.from({ length: pages }, (_, i) => i).sort(
    (a, b) => Math.abs(a - focus) - Math.abs(b - focus) || a - b,
  );
  return new Set(order.slice(0, keep));
}
