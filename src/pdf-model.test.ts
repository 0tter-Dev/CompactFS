import assert from "node:assert/strict";
import { test } from "node:test";
import { pageRatio, pagesToKeep, pdfRenderWidth } from "./pdf-model.ts";

test("pdfRenderWidth multiplica a largura pela densidade da tela", () => {
  assert.equal(pdfRenderWidth(360, 3), 1080);
  assert.equal(pdfRenderWidth(400.4, 2), 801);
});

test("pdfRenderWidth respeita os limites mínimo e máximo", () => {
  assert.equal(pdfRenderWidth(50, 1), 200);
  assert.equal(pdfRenderWidth(1200, 3), 2000);
});

test("pdfRenderWidth trata densidade menor que 1 como 1", () => {
  assert.equal(pdfRenderWidth(500, 0.5), 500);
  assert.equal(pdfRenderWidth(500, 0), 500);
});

test("pageRatio é largura sobre altura", () => {
  assert.equal(pageRatio(595, 842), 595 / 842);
  assert.equal(pageRatio(842, 595), 842 / 595);
});

test("pageRatio devolve 1 quando o tamanho é inválido", () => {
  assert.equal(pageRatio(0, 842), 1);
  assert.equal(pageRatio(595, 0), 1);
  assert.equal(pageRatio(-1, -1), 1);
});

test("pagesToKeep fica com as páginas mais próximas da que está em foco", () => {
  assert.deepEqual([...pagesToKeep(5, 20, 5)].sort((a, b) => a - b), [3, 4, 5, 6, 7]);
});

test("pagesToKeep no começo e no fim não passa dos limites", () => {
  assert.deepEqual([...pagesToKeep(0, 20, 3)].sort((a, b) => a - b), [0, 1, 2]);
  assert.deepEqual([...pagesToKeep(19, 20, 3)].sort((a, b) => a - b), [17, 18, 19]);
});

test("pagesToKeep com poucas páginas mantém todas", () => {
  assert.deepEqual([...pagesToKeep(1, 2, 6)].sort((a, b) => a - b), [0, 1]);
  assert.equal(pagesToKeep(0, 0, 6).size, 0);
});

test("pagesToKeep desempata a favor da página anterior", () => {
  // Equidistantes de 5: 4 e 6. Com folga para 2, entram 5 e 4.
  assert.deepEqual([...pagesToKeep(5, 10, 2)].sort((a, b) => a - b), [4, 5]);
});
