import assert from "node:assert/strict";
import test from "node:test";
import { decodeThumbnail, thumbKey, THUMB_PX } from "./thumb-codec.ts";

function encode(width: number, height: number, pixels: number[]): ArrayBuffer {
  const bytes = new Uint8Array(8 + pixels.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, width, true);
  view.setUint32(4, height, true);
  bytes.set(pixels, 8);
  return bytes.buffer;
}

test("decodeThumbnail lê largura, altura e pixels", () => {
  const out = decodeThumbnail(encode(2, 1, [1, 2, 3, 4, 5, 6, 7, 8]));
  assert.equal(out.width, 2);
  assert.equal(out.height, 1);
  assert.deepEqual([...out.pixels], [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("decodeThumbnail rejeita respostas truncadas ou inconsistentes", () => {
  assert.throws(() => decodeThumbnail(new ArrayBuffer(4)), /truncada/);
  assert.throws(() => decodeThumbnail(encode(2, 2, [1, 2, 3, 4])), /inconsistente/); // faltam pixels
  assert.throws(() => decodeThumbnail(encode(1, 1, [1, 2, 3, 4, 5, 6])), /inconsistente/); // sobram
  assert.throws(() => decodeThumbnail(encode(0, 5, [])), /inconsistente/);
  assert.throws(() => decodeThumbnail(encode(5, 0, [])), /inconsistente/);
});

test("decodeThumbnail não se confunde com dimensões enormes (estouro de 32 bits)", () => {
  // 65536 x 65536 x 4 = 2^34: se a conta fosse em 32 bits, daria 0 e "bateria" com 8 bytes.
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, 65536, true);
  view.setUint32(4, 65536, true);
  assert.throws(() => decodeThumbnail(buf), /inconsistente/);
});

test("thumbKey muda quando o arquivo muda", () => {
  const base = thumbKey("D:\\a.jpg", 1000, 50);
  assert.equal(base, thumbKey("D:\\a.jpg", 1000, 50));
  assert.notEqual(base, thumbKey("D:\\a.jpg", 1001, 50));
  assert.notEqual(base, thumbKey("D:\\a.jpg", 1000, 51));
  assert.notEqual(base, thumbKey("D:\\b.jpg", 1000, 50));
  assert.ok(base.endsWith(`|${THUMB_PX}`));
});

test("thumbKey aceita data e tamanho ausentes", () => {
  assert.equal(thumbKey("x", null, null), `x|||${THUMB_PX}`);
});
