import assert from "node:assert/strict";
import test from "node:test";
import { moveSelection, scrollTopToReveal, visibleRange } from "./viewport.ts";

test("visibleRange cobre a janela mais a folga e respeita os limites", () => {
  assert.deepEqual(visibleRange(0, 280, 28, 1000, 5), { start: 0, end: 15 });
  assert.deepEqual(visibleRange(2800, 280, 28, 1000, 5), { start: 95, end: 115 });
  assert.deepEqual(visibleRange(27_900, 280, 28, 1000, 5), { start: 991, end: 1000 });
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
