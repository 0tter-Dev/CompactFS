import assert from "node:assert/strict";
import test from "node:test";
import { LoadQueue, type LoadResult } from "./load-queue.ts";

/** Carregamento controlável pelo teste. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const noop = () => {};

test("nunca passa do limite de carregamentos simultâneos", async () => {
  const q = new LoadQueue<number>(2);
  const gates = [deferred<number>(), deferred<number>(), deferred<number>(), deferred<number>()];
  const started: string[] = [];
  gates.forEach((g, i) =>
    q.request(
      `k${i}`,
      () => {
        started.push(`k${i}`);
        return g.promise;
      },
      noop,
    ),
  );
  assert.equal(q.inFlightCount, 2);
  assert.equal(q.pendingCount, 2);
  gates[1]!.resolve(1);
  await tick();
  assert.equal(q.inFlightCount, 2);
  assert.equal(started.length, 3);
});

test("o pedido mais recente sai primeiro", async () => {
  const q = new LoadQueue<number>(1);
  const first = deferred<number>();
  const order: string[] = [];
  q.request("primeiro", () => first.promise, noop);
  for (const k of ["a", "b", "c"]) {
    q.request(
      k,
      async () => {
        order.push(k);
        return 0;
      },
      noop,
    );
  }
  first.resolve(0);
  await tick();
  await tick();
  assert.deepEqual(order, ["c", "b", "a"]);
});

test("pedidos da mesma chave viram um carregamento só e todos recebem o resultado", async () => {
  const q = new LoadQueue<string>(1);
  let loads = 0;
  const got: string[] = [];
  const g = deferred<string>();
  const load = () => {
    loads += 1;
    return g.promise;
  };
  q.request("x", load, (r) => r.ok && got.push(`1:${r.value}`));
  q.request("x", load, (r) => r.ok && got.push(`2:${r.value}`));
  g.resolve("ok");
  await tick();
  assert.equal(loads, 1);
  assert.deepEqual(got, ["1:ok", "2:ok"]);
});

test("cancelar o último interessado descarta o que ainda não começou", async () => {
  const q = new LoadQueue<number>(1);
  const block = deferred<number>();
  q.request("bloqueio", () => block.promise, noop);
  let ran = false;
  q.request(
    "some",
    async () => {
      ran = true;
      return 1;
    },
    noop,
  );
  assert.equal(q.pendingCount, 1);
  q.cancel("some", noop);
  assert.equal(q.pendingCount, 0);
  block.resolve(0);
  await tick();
  assert.equal(ran, false);
});

test("cancelar um item em andamento não impede o resultado de quem ainda quer", async () => {
  const q = new LoadQueue<number>(1);
  const g = deferred<number>();
  const a: LoadResult<number>[] = [];
  const b: LoadResult<number>[] = [];
  const la = (r: LoadResult<number>) => a.push(r);
  const lb = (r: LoadResult<number>) => b.push(r);
  q.request("k", () => g.promise, la);
  q.request("k", () => g.promise, lb);
  q.cancel("k", la);
  g.resolve(5);
  await tick();
  assert.equal(a.length, 0);
  assert.deepEqual(b, [{ ok: true, value: 5 }]);
});

test("falha do carregamento chega como erro e libera a vaga", async () => {
  const q = new LoadQueue<number>(1);
  const results: LoadResult<number>[] = [];
  q.request("ruim", () => Promise.reject(new Error("falhou")), (r) => results.push(r));
  q.request("bom", async () => 7, (r) => results.push(r));
  await tick();
  await tick();
  assert.equal(results.length, 2);
  assert.equal(results.some((r) => !r.ok), true);
  assert.deepEqual(results.find((r) => r.ok), { ok: true, value: 7 });
  assert.equal(q.inFlightCount, 0);
});

test("carregador que lança de forma síncrona também vira erro, sem travar a fila", async () => {
  const q = new LoadQueue<number>(1);
  const results: LoadResult<number>[] = [];
  q.request(
    "explode",
    () => {
      throw new Error("síncrono");
    },
    (r) => results.push(r),
  );
  q.request("ok", async () => 1, (r) => results.push(r));
  await tick();
  await tick();
  assert.equal(results.length, 2);
  assert.equal(q.inFlightCount, 0);
});

test("clearPending descarta a espera mas não o que está em andamento", async () => {
  const q = new LoadQueue<number>(1);
  const g = deferred<number>();
  const done: string[] = [];
  q.request("andando", () => g.promise, () => done.push("andando"));
  q.request("espera", async () => 1, () => done.push("espera"));
  q.clearPending();
  assert.equal(q.pendingCount, 0);
  g.resolve(1);
  await tick();
  assert.deepEqual(done, ["andando"]);
});

test("pedir de novo uma chave pendente a leva para a frente da fila", async () => {
  const q = new LoadQueue<number>(1);
  const block = deferred<number>();
  const order: string[] = [];
  const mark = (k: string) => async () => {
    order.push(k);
    return 0;
  };
  q.request("bloqueio", () => block.promise, noop);
  q.request("a", mark("a"), noop);
  q.request("b", mark("b"), noop);
  q.request("a", mark("a"), noop); // volta a ser relevante
  block.resolve(0);
  await tick();
  await tick();
  assert.deepEqual(order, ["a", "b"]);
});

test("concorrência inválida é rejeitada", () => {
  assert.throws(() => new LoadQueue<number>(0), RangeError);
});
