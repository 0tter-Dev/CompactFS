import assert from "node:assert/strict";
import test from "node:test";
import {
  gridLayout,
  gridPosition,
  gridRange,
  moveGridSelection,
  moveSelection,
  scrollTopToReveal,
  visibleRange,
} from "./viewport.ts";

test("visibleRange cobre a janela mais a folga e respeita os limites", () => {
  assert.deepEqual(visibleRange(0, 280, 28, 1000, 5), { start: 0, end: 15 });
  assert.deepEqual(visibleRange(2800, 280, 28, 1000, 5), { start: 95, end: 115 });
  // Perto do fim: o último item (índice 999) precisa estar dentro do intervalo.
  assert.deepEqual(visibleRange(27_900, 280, 28, 1000, 5), { start: 985, end: 1000 });
  // Rolagem além do conteúdo vale como o fim, nunca um intervalo invertido.
  assert.deepEqual(visibleRange(10_000_000, 280, 28, 1000, 5), { start: 985, end: 1000 });
});

test("visibleRange lida com lista vazia, scroll negativo e altura zero", () => {
  assert.deepEqual(visibleRange(0, 280, 28, 0, 5), { start: 0, end: 0 });
  assert.deepEqual(visibleRange(-50, 280, 28, 100, 0), { start: 0, end: 10 });
  assert.deepEqual(visibleRange(0, 0, 28, 100, 0), { start: 0, end: 0 });
  assert.deepEqual(visibleRange(0, 280, 0, 100, 0), { start: 0, end: 0 });
});

test("o número de linhas renderizadas não depende do total (virtualização)", () => {
  const small = visibleRange(0, 280, 28, 100, 5);
  const huge = visibleRange(0, 280, 28, 1_000_000, 5);
  assert.equal(small.end - small.start, huge.end - huge.start);
  const middle = visibleRange(14_000_000, 280, 28, 1_000_000, 5);
  assert.ok(middle.end - middle.start <= 25);
});

test("scrollTopToReveal só rola quando a linha está fora da janela", () => {
  assert.equal(scrollTopToReveal(5, 28, 280, 0), 0);
  assert.equal(scrollTopToReveal(20, 28, 280, 0), 20 * 28 + 28 - 280);
  assert.equal(scrollTopToReveal(1, 28, 280, 280), 28);
  assert.equal(scrollTopToReveal(10, 28, 280, 280), 280);
});

test("moveSelection anda, limita nas pontas e trata lista vazia", () => {
  assert.equal(moveSelection(2, "ArrowDown", 10, 5), 3);
  assert.equal(moveSelection(4, "ArrowDown", 10, 5), 4);
  assert.equal(moveSelection(0, "ArrowUp", 10, 5), 0);
  assert.equal(moveSelection(2, "PageDown", 10, 50), 12);
  assert.equal(moveSelection(2, "PageUp", 10, 50), 0);
  assert.equal(moveSelection(2, "Home", 10, 50), 0);
  assert.equal(moveSelection(2, "End", 10, 50), 49);
  assert.equal(moveSelection(0, "ArrowDown", 10, 0), -1);
});

test("moveSelection sem seleção começa na ponta certa", () => {
  assert.equal(moveSelection(-1, "ArrowDown", 10, 5), 0);
  assert.equal(moveSelection(-1, "ArrowUp", 10, 5), 4);
  assert.equal(moveSelection(-1, "PageDown", 10, 50), 9);
});

test("gridLayout calcula colunas, linhas, centralização e altura", () => {
  const l = gridLayout(900, 148, 160, 100, 12);
  assert.equal(l.cols, 5); // (900 - 24) / 148 = 5,9
  assert.equal(l.rows, 20);
  assert.equal(l.offsetX, Math.floor((900 - 5 * 148) / 2));
  assert.equal(l.height, 20 * 160 + 12);
});

test("gridLayout em janela estreita e sem itens", () => {
  assert.equal(gridLayout(100, 148, 160, 10, 12).cols, 1);
  assert.equal(gridLayout(0, 148, 160, 10, 12).cols, 1);
  const empty = gridLayout(900, 148, 160, 0, 12);
  assert.deepEqual([empty.rows, empty.height], [0, 0]);
});

test("gridRange devolve índices de linhas inteiras e respeita o total", () => {
  // 5 colunas, linhas de 160 px, janela de 480 px = 3 linhas visíveis.
  assert.deepEqual(gridRange(0, 480, 160, 5, 100, 0), { start: 0, end: 15 });
  assert.deepEqual(gridRange(0, 480, 160, 5, 100, 1), { start: 0, end: 20 });
  assert.deepEqual(gridRange(1600, 480, 160, 5, 100, 1), { start: 45, end: 70 });
  // 98 itens = 20 linhas; rolagem além do fim vale como as últimas linhas, com o último item incluído.
  assert.deepEqual(gridRange(99_999, 480, 160, 5, 98, 2), { start: 75, end: 98 });
  assert.deepEqual(gridRange(0, 480, 160, 5, 0, 1), { start: 0, end: 0 });
});

test("gridRange não depende do total (virtualização)", () => {
  const a = gridRange(0, 480, 160, 5, 100, 2);
  const b = gridRange(0, 480, 160, 5, 5_000_000, 2);
  assert.equal(a.end - a.start, b.end - b.start);
});

test("gridPosition coloca cada índice na coluna e linha certas", () => {
  assert.deepEqual(gridPosition(0, 5, 148, 160, 10, 6), { x: 10, y: 6 });
  assert.deepEqual(gridPosition(7, 5, 148, 160, 10, 6), { x: 10 + 2 * 148, y: 6 + 160 });
});

test("moveGridSelection: esquerda e direita andam um item, cima e baixo uma linha", () => {
  assert.equal(moveGridSelection(7, "ArrowRight", 5, 3, 20), 8);
  assert.equal(moveGridSelection(7, "ArrowLeft", 5, 3, 20), 6);
  assert.equal(moveGridSelection(7, "ArrowDown", 5, 3, 20), 12);
  assert.equal(moveGridSelection(7, "ArrowUp", 5, 3, 20), 2);
});

test("moveGridSelection: limites e última linha incompleta", () => {
  assert.equal(moveGridSelection(0, "ArrowLeft", 5, 3, 20), 0);
  assert.equal(moveGridSelection(19, "ArrowRight", 5, 3, 20), 19);
  assert.equal(moveGridSelection(2, "ArrowUp", 5, 3, 20), 2); // já na primeira linha
  // 18 itens: a última linha tem 3 (índices 15 a 17). Do índice 13 (coluna 3) não há coluna 3 abaixo.
  assert.equal(moveGridSelection(13, "ArrowDown", 5, 3, 18), 17);
  assert.equal(moveGridSelection(17, "ArrowDown", 5, 3, 18), 17); // já na última linha
  assert.equal(moveGridSelection(3, "ArrowDown", 5, 3, 18), 8);
});

test("moveGridSelection: páginas, Home, End e sem seleção", () => {
  assert.equal(moveGridSelection(12, "PageDown", 5, 2, 50), 22);
  assert.equal(moveGridSelection(12, "PageUp", 5, 2, 50), 2);
  assert.equal(moveGridSelection(7, "PageUp", 5, 3, 50), 2); // passa do topo: mesma coluna na 1ª linha
  assert.equal(moveGridSelection(48, "PageDown", 5, 3, 50), 49);
  assert.equal(moveGridSelection(12, "Home", 5, 3, 50), 0);
  assert.equal(moveGridSelection(12, "End", 5, 3, 50), 49);
  assert.equal(moveGridSelection(-1, "ArrowDown", 5, 3, 50), 0);
  assert.equal(moveGridSelection(-1, "ArrowLeft", 5, 3, 50), 49);
  assert.equal(moveGridSelection(0, "ArrowRight", 5, 3, 0), -1);
});
