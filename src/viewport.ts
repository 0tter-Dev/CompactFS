/** Matemática da lista virtual: só as linhas visíveis (mais uma folga) existem no DOM. */

export interface Range {
  start: number;
  /** Exclusivo. */
  end: number;
}

export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  total: number,
  overscan: number,
): Range {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const top = Math.max(0, scrollTop);
  const first = Math.floor(top / rowHeight);
  const last = Math.ceil((top + Math.max(0, viewportHeight)) / rowHeight);
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(total, last + overscan),
  };
}

/** Novo `scrollTop` para deixar a linha `index` totalmente visível; mantém o atual se já estiver. */
export function scrollTopToReveal(
  index: number,
  rowHeight: number,
  viewportHeight: number,
  scrollTop: number,
): number {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) return bottom - viewportHeight;
  return scrollTop;
}

export type NavKey = "ArrowUp" | "ArrowDown" | "PageUp" | "PageDown" | "Home" | "End";

/** Próxima linha selecionada para uma tecla de navegação (`-1` = nada selecionado ainda). */
export function moveSelection(current: number, key: NavKey, pageSize: number, total: number): number {
  if (total <= 0) return -1;
  const last = total - 1;
  const page = Math.max(1, pageSize);
  // Sem seleção, as setas "para trás" começam do fim e as "para frente", do começo.
  const backwards = key === "ArrowUp" || key === "PageUp";
  const from = current < 0 ? (backwards ? total : -1) : current;
  let next: number;
  switch (key) {
    case "ArrowUp":
      next = from - 1;
      break;
    case "ArrowDown":
      next = from + 1;
      break;
    case "PageUp":
      next = from - page;
      break;
    case "PageDown":
      next = from + page;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = last;
      break;
  }
  return Math.min(last, Math.max(0, next));
}
