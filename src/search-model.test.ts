import assert from "node:assert/strict";
import test from "node:test";
import { lastSegment, scopeName, relativeDir, searchStatus, shouldAutoSearch } from "./search-model.ts";

const summary = (over: Record<string, unknown> = {}) => ({
  scannedDirs: 12,
  scannedEntries: 300,
  matches: 5,
  skippedDirs: 0,
  truncated: false,
  cancelled: false,
  elapsedMs: 34,
  ...over,
});

test("a busca automática só começa com 2 caracteres de verdade", () => {
  assert.equal(shouldAutoSearch(""), false);
  assert.equal(shouldAutoSearch("a"), false);
  assert.equal(shouldAutoSearch("  a  "), false);
  assert.equal(shouldAutoSearch("ab"), true);
  assert.equal(shouldAutoSearch(" ab "), true);
  assert.equal(shouldAutoSearch("😀"), false, "um emoji é um caractere só");
  assert.equal(shouldAutoSearch("😀😀"), true);
});

test("relativeDir mostra a pasta do resultado a partir da pasta da busca", () => {
  assert.equal(relativeDir("D:\\fotos", "D:\\fotos", "\\"), "");
  assert.equal(relativeDir("D:\\fotos", "D:\\fotos\\2024", "\\"), "2024");
  assert.equal(relativeDir("D:\\fotos", "D:\\fotos\\2024\\praia", "\\"), "2024\\praia");
});

test("relativeDir lida com a raiz do disco e com barra no fim", () => {
  assert.equal(relativeDir("D:\\", "D:\\a\\b", "\\"), "a\\b");
  assert.equal(relativeDir("D:\\", "D:\\", "\\"), "");
  assert.equal(relativeDir("D:\\fotos\\", "D:\\fotos\\x", "\\"), "x");
  assert.equal(relativeDir("/", "/home/ana", "/"), "home/ana");
  assert.equal(relativeDir("/home", "/home/ana/docs", "/"), "ana/docs");
});

test("relativeDir não confunde pastas com o mesmo começo de nome", () => {
  // "D:\fotos2" NÃO está dentro de "D:\fotos".
  assert.equal(relativeDir("D:\\fotos", "D:\\fotos2\\a", "\\"), "D:\\fotos2\\a");
  assert.equal(relativeDir("D:\\fotos", "E:\\outra", "\\"), "E:\\outra");
});

test("o texto de andamento mostra resultados e pastas examinadas", () => {
  const text = searchStatus({ query: "praia", matches: 1, scannedDirs: 1, summary: null });
  assert.equal(text, "Buscando “praia”… 1 resultado · 1 pasta examinada");
  assert.match(searchStatus({ query: "x", matches: 2500, scannedDirs: 3, summary: null }), /2\.500 resultados · 3 pastas examinadas/);
});

test("o texto final cobre resultados, tempo, limite, pastas sem acesso e cancelamento", () => {
  const done = searchStatus({ query: "praia", matches: 5, scannedDirs: 12, summary: summary() });
  assert.equal(done, "5 resultados para “praia” · 12 pastas examinadas em 34 ms");
  assert.equal(searchStatus({ query: "q", matches: 1, scannedDirs: 1, summary: summary({ matches: 1, scannedDirs: 1 }) }), "1 resultado para “q” · 1 pasta examinada em 34 ms");
  assert.match(searchStatus({ query: "q", matches: 0, scannedDirs: 1, summary: summary({ matches: 0 }) }), /^Nenhum resultado para “q”/);
  assert.match(searchStatus({ query: "q", matches: 10000, scannedDirs: 1, summary: summary({ matches: 10000, truncated: true }) }), /mostrando só os primeiros 10\.000: refine a busca/);
  assert.match(searchStatus({ query: "q", matches: 1, scannedDirs: 1, summary: summary({ skippedDirs: 2 }) }), /2 pastas sem acesso ignoradas/);
  assert.match(searchStatus({ query: "q", matches: 1, scannedDirs: 1, summary: summary({ skippedDirs: 1 }) }), /1 pasta sem acesso ignorada/);
  assert.match(searchStatus({ query: "q", matches: 1, scannedDirs: 1, summary: summary({ cancelled: true }) }), /busca interrompida/);
});

test("lastSegment devolve só o nome da pasta", () => {
  assert.equal(lastSegment("D:\\fotos\\2024"), "2024");
  assert.equal(lastSegment("D:\\fotos\\2024\\"), "2024");
  assert.equal(lastSegment("D:\\"), "D:");
  assert.equal(lastSegment("D:/fotos/2024"), "2024");
  assert.equal(lastSegment("/home/ana"), "ana");
  assert.equal(lastSegment("/"), "/");
  assert.equal(lastSegment(""), "");
});

test("scopeName usa o nome da trilha quando ele é o da pasta da busca", () => {
  const crumbs = [
    { name: "Armazenamento interno", path: "/storage/emulated/0" },
    { name: "DCIM", path: "/storage/emulated/0/DCIM" },
  ];
  assert.equal(scopeName("/storage/emulated/0", crumbs.slice(0, 1)), "Armazenamento interno");
  assert.equal(scopeName("/storage/emulated/0/DCIM", crumbs), "DCIM");
});

test("scopeName cai para o último nível do caminho quando a trilha não bate", () => {
  assert.equal(scopeName("D:\\fotos\\2024", []), "2024");
  assert.equal(scopeName("D:\\fotos", [{ name: "Outra", path: "D:\\outra" }]), "fotos");
});
