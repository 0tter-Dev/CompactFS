import assert from "node:assert/strict";
import test from "node:test";
import { formatDate, formatSize, joinPath } from "./format.ts";

test("formatSize usa base 1024 e vírgula decimal", () => {
  assert.equal(formatSize(0), "0 B");
  assert.equal(formatSize(1023), "1.023 B");
  assert.equal(formatSize(1024), "1 KB");
  assert.equal(formatSize(1536), "1,5 KB");
  assert.equal(formatSize(1024 * 1024), "1 MB");
  assert.equal(formatSize(5 * 1024 ** 3), "5 GB");
});

test("formatSize não quebra com valores inválidos nem enormes", () => {
  assert.equal(formatSize(-1), "");
  assert.equal(formatSize(Number.NaN), "");
  assert.equal(formatSize(Number.POSITIVE_INFINITY), "");
  assert.equal(formatSize(2 ** 60), "1.024 PB");
});

test("formatDate devolve vazio sem data e texto com data", () => {
  assert.equal(formatDate(null), "");
  assert.match(formatDate(Date.UTC(2024, 0, 15, 12, 30)), /\d{2}\/\d{2}\/\d{4}/);
});

test("joinPath não duplica o separador na raiz do disco", () => {
  assert.equal(joinPath("D:\\", "fotos", "\\"), "D:\\fotos");
  assert.equal(joinPath("D:\\fotos", "2024", "\\"), "D:\\fotos\\2024");
  assert.equal(joinPath("/", "home", "/"), "/home");
  assert.equal(joinPath("/home", "ana", "/"), "/home/ana");
});
