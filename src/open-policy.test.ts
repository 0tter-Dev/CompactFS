import assert from "node:assert/strict";
import { test } from "node:test";
import { openAction } from "./open-policy.ts";

test("pasta sempre navega, com ou sem a opção", () => {
  assert.equal(openAction("dir", false, false), "folder");
  assert.equal(openAction("dir", false, true), "folder");
});

test("arquivo com visualizador abre nele por padrão", () => {
  assert.equal(openAction("file", true, false), "viewer");
});

test("com 'Sempre abrir no app padrão' o arquivo com visualizador vai para o app padrão", () => {
  assert.equal(openAction("file", true, true), "default");
});

test("arquivo sem visualizador vai para o app padrão, com ou sem a opção", () => {
  assert.equal(openAction("file", false, false), "default");
  assert.equal(openAction("file", false, true), "default");
});

test("outros tipos de entrada não abrem visualizador", () => {
  assert.equal(openAction("other", true, false), "default");
  assert.equal(openAction("other", false, true), "default");
});
