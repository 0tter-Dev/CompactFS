import assert from "node:assert/strict";
import test from "node:test";
import { Lru } from "./lru.ts";

test("descarta o menos recentemente usado ao passar do limite", () => {
  const evicted: string[] = [];
  const lru = new Lru<string, number>(2, (k) => evicted.push(k));
  lru.set("a", 1);
  lru.set("b", 2);
  lru.set("c", 3);
  assert.deepEqual(evicted, ["a"]);
  assert.equal(lru.has("a"), false);
  assert.equal(lru.size, 2);
});

test("ler um item o protege de ser descartado; peek não", () => {
  const evicted: string[] = [];
  const lru = new Lru<string, number>(2, (k) => evicted.push(k));
  lru.set("a", 1);
  lru.set("b", 2);
  lru.get("a"); // a vira o mais recente
  lru.set("c", 3);
  assert.deepEqual(evicted, ["b"]);

  const evicted2: string[] = [];
  const lru2 = new Lru<string, number>(2, (k) => evicted2.push(k));
  lru2.set("a", 1);
  lru2.set("b", 2);
  lru2.peek("a"); // não muda a ordem
  lru2.set("c", 3);
  assert.deepEqual(evicted2, ["a"]);
});

test("guarda valores falsy (null) e diferencia ausente de null", () => {
  const lru = new Lru<string, null | number>(3);
  lru.set("falhou", null);
  lru.set("zero", 0);
  assert.equal(lru.get("falhou"), null);
  assert.equal(lru.get("zero"), 0);
  assert.equal(lru.get("nunca"), undefined);
  assert.equal(lru.has("falhou"), true);
});

test("substituir um valor libera o antigo, mas regravar o mesmo não", () => {
  const evicted: number[] = [];
  const lru = new Lru<string, number>(3, (_k, v) => evicted.push(v));
  lru.set("a", 1);
  lru.set("a", 2);
  lru.set("a", 2);
  assert.deepEqual(evicted, [1]);
  assert.equal(lru.size, 1);
});

test("clear libera todos os itens", () => {
  const evicted: number[] = [];
  const lru = new Lru<string, number>(5, (_k, v) => evicted.push(v));
  lru.set("a", 1);
  lru.set("b", 2);
  lru.clear();
  assert.deepEqual(evicted.sort(), [1, 2]);
  assert.equal(lru.size, 0);
});

test("limite inválido é rejeitado", () => {
  assert.throws(() => new Lru<string, number>(0), RangeError);
  assert.throws(() => new Lru<string, number>(1.5), RangeError);
});
