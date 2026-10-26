// Teste de ponta a ponta de "Sempre abrir com o app padrão". Ver como rodar em cdp.mjs.
// Intercepta a chamada de rede do comando `open_default` (CDP `Fetch`) para NÃO abrir programas de
// verdade; só o `.exe` vai ao núcleo real, que o recusa. Antes de qualquer clique, o roteiro confere que a
// interceptação está ativa e aborta se não estiver. Cria e apaga uma pasta própria na pasta temporária.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect } from "./cdp.mjs";

const CTRL = 2;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "compactfs-opendefault-"));
fs.mkdirSync(path.join(root, "sub"));
for (const name of ["a.txt", "b.png", "c.pdf", "d.md", "e.exe"]) fs.writeFileSync(path.join(root, name), "x");

const { ev, send, on, sleep, waitFor, press, type, check, finish } = await connect();

const viewerOpen = () => ev(`!document.getElementById('viewer').hidden`);
const intercepted = [];
const calls = async () => intercepted.map((b) => JSON.parse(b).path);
const status = () => ev(`document.getElementById('status-main').textContent`);
const lastCrumb = () => ev(`[...document.querySelectorAll('#crumbs .crumb')].pop()?.textContent`);
const tile = (name) =>
  `[...document.querySelectorAll('#grid .tile')].find(t => t.querySelector('.tname')?.textContent.trim() === ${JSON.stringify(name)})`;
const dbl = (name) => ev(`(() => { const t = ${tile(name)}; if (!t) return false; t.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true; })()`);
const closeViewer = async () => {
  if (await viewerOpen()) {
    await press("Escape");
    await sleep(400);
  }
};
/** Responde ao `open_default` sem chamar o núcleo (menos para `.exe`); o resto passa direto. */
on("Fetch.requestPaused", async (p) => {
  const body = p.request.postData ?? "";
  const isOpen = /open_default/.test(p.request.url) && p.request.method === "POST";
  if (isOpen && !/\.exe/i.test(body)) {
    intercepted.push(body);
    await send("Fetch.fulfillRequest", {
      requestId: p.requestId,
      responseCode: 200,
      responseHeaders: [
        { name: "Content-Type", value: "application/json" },
        { name: "Tauri-Response", value: "ok" },
        { name: "Access-Control-Allow-Origin", value: "*" },
        { name: "Access-Control-Expose-Headers", value: "Tauri-Response" },
      ],
      body: Buffer.from("null").toString("base64"),
    });
  } else {
    await send("Fetch.continueRequest", { requestId: p.requestId });
  }
});
const installStub = async () => {
  await send("Fetch.enable", { patterns: [{ urlPattern: "*ipc.localhost*", requestStage: "Request" }] });
  // Autoverificação: um caminho que não existe só "dá certo" se a interceptação estiver ativa
  // (no núcleo real a chamada seria recusada com "não encontrado" e nada seria aberto).
  const probe = await ev(`window.__TAURI_INTERNALS__.invoke('open_default', { path: 'C:\\\\compactfs-nao-existe\\\\x.txt' }).then(() => 'interceptado', () => 'REAL')`);
  if (probe !== "interceptado") {
    console.log("ABORTADO: a interceptação do open_default não está ativa; nenhum arquivo foi aberto.");
    process.exit(2);
  }
  intercepted.length = 0;
};

try {
  await waitFor(`document.querySelector('.drive') !== null`, 8000);
  await press("l", CTRL);
  await waitFor(`!document.getElementById('address').hidden`);
  await ev(`document.getElementById('address').select()`);
  await type(root);
  await press("Enter");
  await waitFor(`document.querySelectorAll('#grid .tile').length >= 6`, 8000);
  await installStub();

  check("a opção começa desligada", (await ev(`document.getElementById('always-default').checked`)) === false);

  // --- desligada: o visualizador próprio abre
  await dbl("a.txt");
  await waitFor(`!document.getElementById('viewer').hidden`, 5000);
  check("desligada, o texto abre no visualizador do app", await viewerOpen());
  check("e nada vai para o app padrão", (await calls()).length === 0);
  await closeViewer();

  // --- ligada
  await ev(`document.getElementById('always-default').click()`);
  check("ligar a opção marca a caixa", await ev(`document.getElementById('always-default').checked`));
  check("a escolha fica guardada", (await ev(`localStorage.getItem('cfs.alwaysDefault')`)) === "1");

  for (const name of ["a.txt", "b.png", "c.pdf", "d.md"]) {
    const before = (await calls()).length;
    await dbl(name);
    await sleep(500);
    const after = await calls();
    check(`ligada, ${name} vai para o app padrão`, after.length === before + 1 && after.at(-1).endsWith(name), JSON.stringify(after));
    check(`ligada, ${name} não abre o visualizador`, !(await viewerOpen()));
  }
  check("o status avisa que abriu no app padrão", /no app padrão/.test(await status()), await status());

  // --- teclado (Enter no arquivo selecionado)
  const before = (await calls()).length;
  await ev(`(() => { const t = ${tile("a.txt")}; t.click(); document.getElementById('grid').focus(); })()`);
  await press("Enter");
  await sleep(500);
  const afterKey = await calls();
  check("ligada, Enter no teclado também vai para o app padrão", afterKey.length === before + 1 && afterKey.at(-1).endsWith("a.txt"));
  check("e não abre o visualizador", !(await viewerOpen()));

  // --- pasta continua navegando
  await dbl("sub");
  await waitFor(`[...document.querySelectorAll('#crumbs .crumb')].pop()?.textContent === 'sub'`, 5000);
  check("ligada, a pasta continua abrindo normalmente", (await lastCrumb()) === "sub");
  await ev(`document.getElementById('up').click()`);
  await waitFor(`document.querySelectorAll('#grid .tile').length >= 6`, 5000);
  await sleep(400);

  // --- programa: o núcleo recusa, nada é aberto
  const beforeExe = (await calls()).length;
  await dbl("e.exe");
  await waitFor(`/não é aberto pelo CompactFS/.test(document.getElementById('status-main').textContent)`, 5000);
  check("ligada, um .exe continua bloqueado pelo núcleo", /não é aberto pelo CompactFS/.test(await status()), await status());
  check("e a chamada interceptada não o viu", (await calls()).length === beforeExe);

  // --- persiste ao reabrir
  await ev(`location.reload()`);
  await sleep(1500);
  await waitFor(`document.querySelector('.drive') !== null`, 10000);
  check("depois de recarregar, a opção continua ligada", await ev(`document.getElementById('always-default').checked`));

  // --- desligar volta ao visualizador
  await press("l", CTRL);
  await waitFor(`!document.getElementById('address').hidden`);
  await ev(`document.getElementById('address').select()`);
  await type(root);
  await press("Enter");
  await waitFor(`document.querySelectorAll('#grid .tile').length >= 6`, 8000);
  await installStub();
  await ev(`document.getElementById('always-default').click()`);
  check("desligar guarda a escolha", (await ev(`localStorage.getItem('cfs.alwaysDefault')`)) === "0");
  await dbl("a.txt");
  await waitFor(`!document.getElementById('viewer').hidden`, 5000);
  check("desligada de novo, o visualizador do app volta a abrir", await viewerOpen());
  check("e nada foi para o app padrão", (await calls()).length === 0);
  await closeViewer();
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`pasta de teste removida? ${!fs.existsSync(root)}`);
}
finish();
