import assert from "node:assert/strict";
import { test } from "node:test";
import { needsAccessPrompt } from "./access-model.ts";

test("pede o acesso quando há o que pedir e ele ainda não foi dado", () => {
  assert.equal(needsAccessPrompt({ supported: true, granted: false }), true);
});

test("não pede quando o acesso já foi dado", () => {
  assert.equal(needsAccessPrompt({ supported: true, granted: true }), false);
});

test("não pede onde não há o que pedir (Windows, Android antes do 11)", () => {
  assert.equal(needsAccessPrompt({ supported: false, granted: true }), false);
  assert.equal(needsAccessPrompt({ supported: false, granted: false }), false);
});
