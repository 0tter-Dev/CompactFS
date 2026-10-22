/** Matemática das listas virtuais: só as linhas visíveis (mais uma folga) existem no DOM. */

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
  // Como o navegador, a rolagem nunca passa do fim do conteúdo (o intervalo nunca fica invertido).
  const maxTop = Math.max(0, total * rowHeight - Math.max(0, viewportHeight));
  const top = Math.min(Math.max(0, scrollTop), maxTop);
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

// ---------- grade (galeria) ----------

export interface GridLayout {
  cols: number;
  rows: number;
  /** Deslocamento horizontal que centraliza as colunas no espaço disponível. */
  offsetX: number;
  /** Altura total do conteúdo, para o espaçador de rolagem. */
  height: number;
}

export function gridLayout(
  containerWidth: number,
  tileWidth: number,
  tileHeight: number,
  total: number,
  padding: number,
): GridLayout {
  const usable = Math.max(0, containerWidth - 2 * padding);
  const cols = Math.max(1, Math.floor(usable / Math.max(1, tileWidth)));
  const rows = total > 0 ? Math.ceil(total / cols) : 0;
  const offsetX = Math.max(padding, Math.floor((containerWidth - cols * tileWidth) / 2));
  return { cols, rows, offsetX, height: rows > 0 ? rows * tileHeight + padding : 0 };
}

/** Faixa de índices (fim exclusivo) cujas linhas aparecem na janela, com folga de linhas. */
export function gridRange(
  scrollTop: number,
  viewportHeight: number,
  tileHeight: number,
  cols: number,
  total: number,
  overscanRows: number,
): Range {
  if (total <= 0 || tileHeight <= 0 || cols <= 0) return { start: 0, end: 0 };
  const rows = visibleRange(scrollTop, viewportHeight, tileHeight, Math.ceil(total / cols), overscanRows);
  return { start: rows.start * cols, end: Math.min(total, rows.end * cols) };
}

export function gridPosition(
  index: number,
  cols: number,
  tileWidth: number,
  tileHeight: number,
  offsetX: number,
  paddingTop: number,
): { x: number; y: number } {
  return {
    x: offsetX + (index % cols) * tileWidth,
    y: paddingTop + Math.floor(index / cols) * tileHeight,
  };
}

export type GridKey = NavKey | "ArrowLeft" | "ArrowRight";

/** Próxima seleção na grade (`-1` = nada selecionado). Esquerda e direita andam um item; cima e baixo, uma linha. */
export function moveGridSelection(
  current: number,
  key: GridKey,
  cols: number,
  pageRows: number,
  total: number,
): number {
  if (total <= 0) return -1;
  const last = total - 1;
  const width = Math.max(1, cols);
  if (current < 0) {
    return key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp" || key === "End" ? last : 0;
  }
  const rowOf = (i: number): number => Math.floor(i / width);
  switch (key) {
    case "ArrowLeft":
      return Math.max(0, current - 1);
    case "ArrowRight":
      return Math.min(last, current + 1);
    case "ArrowUp":
      return current - width >= 0 ? current - width : current;
    case "ArrowDown":
      if (current + width <= last) return current + width;
      // Última linha incompleta: vai para o último item, se ainda houver uma linha abaixo.
      return rowOf(current) < rowOf(last) ? last : current;
    case "PageUp": {
      const target = current - width * Math.max(1, pageRows);
      return target >= 0 ? target : current % width;
    }
    case "PageDown":
      return Math.min(last, current + width * Math.max(1, pageRows));
    case "Home":
      return 0;
    case "End":
      return last;
  }
}
