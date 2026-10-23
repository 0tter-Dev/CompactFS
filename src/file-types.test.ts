import assert from "node:assert/strict";
import test from "node:test";
import { extensionOf, isThumbnailable } from "./file-types.ts";

test("extensionOf lida com maiúsculas, vários pontos e nomes sem extensão", () => {
  assert.equal(extensionOf("foto.JPG"), "jpg");
  assert.equal(extensionOf("arquivo.tar.gz"), "gz");
  assert.equal(extensionOf("LEIAME"), "");
  assert.equal(extensionOf(".gitignore"), "");
  assert.equal(extensionOf("termina."), "");
  assert.equal(extensionOf(""), "");
});

test("pede miniatura de imagem, vídeo e PDF, e de mais nada", () => {
  for (const n of ["a.jpg", "B.PNG", "c.webp", "d.heic", "e.mp4", "f.MKV", "g.pdf", "h.cr2"]) {
    assert.equal(isThumbnailable(n), true, n);
  }
  for (const n of ["a.txt", "b.exe", "c.docx", "d", ".jpg", "e.jpg.txt", "f.zip"]) {
    assert.equal(isThumbnailable(n), false, n);
  }
});
