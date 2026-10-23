import assert from "node:assert/strict";
import test from "node:test";
import { clampPan, fitScale, fitted, MAX_SCALE, MIN_SCALE, zoomAt, zoomLabel } from "./zoom.ts";

test("fitScale reduz imagens grandes e não amplia as pequenas", () => {
  assert.equal(fitScale(2000, 1000, 1000, 1000), 0.5);
  assert.equal(fitScale(1000, 4000, 800, 400), 0.1);
  assert.equal(fitScale(100, 50, 800, 600), 1);
});

test("fitScale lida com dimensões inválidas", () => {
  assert.equal(fitScale(0, 100, 800, 600), 1);
  assert.equal(fitScale(100, 100, 0, 600), 1);
  assert.equal(fitScale(-1, -1, 800, 600), 1);
});

test("clampPan centraliza a imagem que cabe e limita a que passa da área", () => {
  const fits = clampPan({ scale: 1, x: 300, y: -200 }, 400, 300, 800, 600);
  assert.deepEqual(fits, { scale: 1, x: 0, y: 0 });
  // Imagem de 2000x1000 a 100% numa área de 800x600: pode andar (2000-800)/2 = 600 e (1000-600)/2 = 200.
  const big = clampPan({ scale: 1, x: 5000, y: -5000 }, 2000, 1000, 800, 600);
  assert.deepEqual(big, { scale: 1, x: 600, y: -200 });
  assert.deepEqual(clampPan({ scale: 1, x: 100, y: 50 }, 2000, 1000, 800, 600), { scale: 1, x: 100, y: 50 });
});

test("zoomAt mantém parado o ponto sob o cursor", () => {
  // Imagem 4000x3000 numa área 800x600; já ampliada a 100%, deslocada, e o cursor a (100, 50) do centro.
  const before = { scale: 1, x: 200, y: -100 };
  const after = zoomAt(before, 2, 100, 50, 4000, 3000, 800, 600);
  assert.equal(after.scale, 2);
  // Ponto da imagem sob o cursor = (px - x) / scale, antes e depois, tem de ser o mesmo.
  assert.equal((100 - before.x) / before.scale, (100 - after.x) / after.scale);
  assert.equal((50 - before.y) / before.scale, (50 - after.y) / after.scale);
});

test("zoomAt respeita os limites de ampliação", () => {
  const z = { scale: 1, x: 0, y: 0 };
  assert.equal(zoomAt(z, 1e9, 0, 0, 100, 100, 800, 600).scale, MAX_SCALE);
  assert.equal(zoomAt(z, 1e-9, 0, 0, 100, 100, 800, 600).scale, MIN_SCALE);
});

test("ao reduzir até caber, a imagem volta para o centro", () => {
  const big = { scale: 2, x: 400, y: 300 };
  const out = zoomAt(big, 0.1, 0, 0, 800, 600, 1000, 800);
  assert.ok(out.scale < 1);
  assert.deepEqual([out.x, out.y], [0, 0]);
});

test("fitted e zoomLabel", () => {
  assert.deepEqual(fitted(2000, 1000, 1000, 1000), { scale: 0.5, x: 0, y: 0 });
  assert.equal(zoomLabel(0.5), "50%");
  assert.equal(zoomLabel(1), "100%");
  assert.equal(zoomLabel(0.333), "33%");
});
