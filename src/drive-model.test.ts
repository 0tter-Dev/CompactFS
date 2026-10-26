import assert from "node:assert/strict";
import { test } from "node:test";
import { driveTitle } from "./drive-model.ts";

test("driveTitle no Windows junta o rótulo e a letra", () => {
  assert.equal(driveTitle("D:\\", "SATA 1TB"), "SATA 1TB (D:)");
});

test("driveTitle no Windows sem rótulo mostra só a letra", () => {
  assert.equal(driveTitle("E:\\", null), "E:");
  assert.equal(driveTitle("e:/", null), "e:");
});

test("driveTitle no Android mostra só o nome do armazenamento", () => {
  assert.equal(driveTitle("/storage/emulated/0", "Armazenamento interno"), "Armazenamento interno");
  assert.equal(driveTitle("/storage/1A2B-3C4D", "Armazenamento removível 1A2B-3C4D"), "Armazenamento removível 1A2B-3C4D");
});

test("driveTitle no Android sem nome cai para o caminho", () => {
  assert.equal(driveTitle("/storage/1A2B-3C4D/", null), "/storage/1A2B-3C4D");
});
