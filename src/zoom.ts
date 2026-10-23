/**
 * Zoom e deslocamento de imagem. A imagem fica centralizada na área de exibição; `x` e `y` são o
 * deslocamento (em pixels da tela) em relação a esse centro, e `scale` é a ampliação.
 */
export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 32;

/** Ampliação que faz a imagem caber na área, sem ampliar além do tamanho real. */
export function fitScale(imageW: number, imageH: number, boxW: number, boxH: number): number {
  if (imageW <= 0 || imageH <= 0 || boxW <= 0 || boxH <= 0) return 1;
  return Math.min(1, boxW / imageW, boxH / imageH);
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Impede de arrastar a imagem para fora da área: se ela cabe, fica centralizada. */
export function clampPan(
  state: ZoomState,
  imageW: number,
  imageH: number,
  boxW: number,
  boxH: number,
): ZoomState {
  const maxX = Math.max(0, (imageW * state.scale - boxW) / 2);
  const maxY = Math.max(0, (imageH * state.scale - boxH) / 2);
  // "|| 0" troca -0 por 0 (Math.max(-0, ...) pode devolver -0).
  return {
    scale: state.scale,
    x: Math.min(maxX, Math.max(-maxX, state.x)) || 0,
    y: Math.min(maxY, Math.max(-maxY, state.y)) || 0,
  };
}

/**
 * Multiplica a ampliação por `factor` mantendo parado o ponto sob o cursor. `px` e `py` são a
 * posição do cursor em relação ao centro da área.
 */
export function zoomAt(
  state: ZoomState,
  factor: number,
  px: number,
  py: number,
  imageW: number,
  imageH: number,
  boxW: number,
  boxH: number,
): ZoomState {
  const scale = clampScale(state.scale * factor);
  const ratio = scale / state.scale;
  return clampPan(
    { scale, x: px - (px - state.x) * ratio, y: py - (py - state.y) * ratio },
    imageW,
    imageH,
    boxW,
    boxH,
  );
}

export function fitted(imageW: number, imageH: number, boxW: number, boxH: number): ZoomState {
  return { scale: fitScale(imageW, imageH, boxW, boxH), x: 0, y: 0 };
}

export function zoomLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
