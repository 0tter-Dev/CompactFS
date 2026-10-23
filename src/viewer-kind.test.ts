import assert from "node:assert/strict";
import test from "node:test";
import { usesAssetProtocol, viewerKindOf } from "./viewer-kind.ts";

test("classifica por extensão, sem diferenciar maiúsculas", () => {
  assert.equal(viewerKindOf("foto.JPG"), "image");
  assert.equal(viewerKindOf("leia-me.MD"), "markdown");
  assert.equal(viewerKindOf("relatorio.pdf"), "pdf");
  assert.equal(viewerKindOf("filme.mkv"), "video");
  assert.equal(viewerKindOf("musica.FLAC"), "audio");
  assert.equal(viewerKindOf("notas.txt"), "text");
  assert.equal(viewerKindOf("config.yaml"), "text");
});

test("tipos que o app não mostra ficam sem visualizador (vão para o app padrão)", () => {
  for (const n of ["planilha.xlsx", "texto.docx", "foto.heic", "scan.tiff", "arquivo.zip", "programa.exe", "semextensao", ".gitignore"]) {
    assert.equal(viewerKindOf(n), null, n);
  }
});

test("nomes que coincidem com propriedades de objeto não enganam a busca", () => {
  for (const n of ["a.constructor", "a.toString", "a.__proto__", "a.hasOwnProperty", "a.valueOf"]) {
    assert.equal(viewerKindOf(n), null, n);
  }
});

test("só imagem, PDF, vídeo e áudio usam o protocolo de arquivos", () => {
  assert.equal(usesAssetProtocol("image"), true);
  assert.equal(usesAssetProtocol("pdf"), true);
  assert.equal(usesAssetProtocol("video"), true);
  assert.equal(usesAssetProtocol("audio"), true);
  assert.equal(usesAssetProtocol("text"), false);
  assert.equal(usesAssetProtocol("markdown"), false);
});
