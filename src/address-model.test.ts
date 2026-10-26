import assert from "node:assert/strict";
import { test } from "node:test";
import { addressText, navigationTarget } from "./address-model.ts";

test("addressText mostra o caminho da pasta aberta", () => {
  assert.equal(addressText({ kind: "dir", path: "D:\\Fotos\\2024" }), "D:\\Fotos\\2024");
});

test("addressText mostra 'Este computador' na tela de discos e sem local", () => {
  assert.equal(addressText({ kind: "computer" }), "Este computador");
  assert.equal(addressText(null), "Este computador");
});

test("navigationTarget leva uma pasta para ela mesma, sem seleção", () => {
  assert.deepEqual(navigationTarget({ kind: "dir", path: "D:\\Fotos" }), {
    place: { kind: "dir", path: "D:\\Fotos" },
    selectName: null,
  });
});

test("navigationTarget leva um arquivo para a pasta dele, com o arquivo selecionado", () => {
  assert.deepEqual(
    navigationTarget({ kind: "file", path: "D:\\Fotos\\a.jpg", parent: "D:\\Fotos", name: "a.jpg" }),
    { place: { kind: "dir", path: "D:\\Fotos" }, selectName: "a.jpg" },
  );
});

test("navigationTarget leva 'Este computador' para a tela de discos", () => {
  assert.deepEqual(navigationTarget({ kind: "computer" }), { place: { kind: "computer" }, selectName: null });
});
