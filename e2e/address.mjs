// Teste de ponta a ponta da barra de endereço editável. Ver como rodar em cdp.mjs.
// Cria e apaga uma pasta própria dentro da pasta temporária; não toca em mais nada.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect } from "./cdp.mjs";

const ALT = 1;
const CTRL = 2;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "compactfs-address-"));
const pastaA = path.join(root, "Pasta A");
const sub = path.join(pastaA, "sub");
fs.mkdirSync(sub, { recursive: true });
fs.mkdirSync(path.join(root, "B"));
fs.writeFileSync(path.join(pastaA, "arquivo.txt"), "x");
fs.writeFileSync(path.join(pastaA, "outro.txt"), "x");
fs.writeFileSync(path.join(sub, "dentro.txt"), "x");

const { ev, sleep, waitFor, press, type, check, finish } = await connect();

const editing = () => ev(`!document.getElementById('address').hidden && document.getElementById('crumbs').hidden`);
const crumbs = () => ev(`[...document.querySelectorAll('#crumbs .crumb')].map(b => b.textContent).join('|')`);
const lastCrumb = async () => (await crumbs()).split("|").pop();
const value = () => ev(`document.getElementById('address').value`);
const invalid = () => ev(`document.getElementById('address').getAttribute('aria-invalid') === 'true'`);
const status = () => ev(`document.getElementById('status-main').textContent`);
const selectedName = () =>
  ev(`(() => {
    const grid = document.getElementById('grid');
    if (!grid.hidden) { const id = grid.getAttribute('aria-activedescendant'); return id ? document.getElementById(id)?.textContent ?? '' : ''; }
    return document.querySelector('#list .row.selected')?.textContent ?? '';
  })()`);
const focusedId = () => ev(`document.activeElement?.id ?? ''`);
const openEdit = async () => {
  await press("l", CTRL);
  await waitFor(`!document.getElementById('address').hidden`);
};
const go = async (text) => {
  if (!(await editing())) await openEdit();
  await ev(`document.getElementById('address').select()`);
  await type(text);
  await press("Enter");
};

try {
  await waitFor(`document.querySelector('#crumbs .crumb') !== null`);
  await sleep(300);

  // --- abrir e fechar a edição
  check("começa mostrando a trilha, sem o campo", !(await editing()) && (await ev(`document.getElementById('address').hidden`)));
  await openEdit();
  check("Ctrl+L troca a trilha pelo campo, com 'Este computador'", (await editing()) && (await value()) === "Este computador");
  check("o campo recebe o foco e o texto vem selecionado", (await focusedId()) === "address" && (await ev(`(() => { const a = document.getElementById('address'); return a.selectionStart === 0 && a.selectionEnd === a.value.length; })()`)));
  await press("Escape");
  check("Esc fecha a edição e volta a trilha", !(await editing()) && (await crumbs()).startsWith("Este computador"));

  await press("F4");
  check("F4 também abre a edição", await waitFor(`!document.getElementById('address').hidden`));
  await press("Escape");
  await press("d", ALT);
  check("Alt+D também abre a edição", await waitFor(`!document.getElementById('address').hidden`));
  await press("Escape");

  // --- navegar por um caminho completo
  await go(pastaA);
  check("Enter com o caminho completo abre a pasta", await waitFor(`document.querySelector('#crumbs .crumb')?.textContent && [...document.querySelectorAll('#crumbs .crumb')].pop().textContent === 'Pasta A'`));
  check("a edição termina depois de navegar", !(await editing()));

  // --- clique num espaço vazio da trilha
  await ev(`document.getElementById('crumbs').click()`);
  check("clicar num espaço vazio da trilha abre a edição", await editing());
  check("o campo vem com o caminho atual", (await value()) === pastaA, await value());
  await press("Escape");
  check("depois do Esc o foco volta para a lista de arquivos", ["grid", "list"].includes(await focusedId()), await focusedId());

  // --- variações do texto digitado
  await go(`"${sub}"`);
  check("caminho entre aspas (Copiar como caminho) funciona", await waitFor(`[...document.querySelectorAll('#crumbs .crumb')].pop()?.textContent === 'sub'`));
  await go(pastaA.replaceAll("\\", "/"));
  check("barras normais funcionam", await waitFor(`[...document.querySelectorAll('#crumbs .crumb')].pop()?.textContent === 'Pasta A'`));
  await go(`  ${pastaA}\\  `);
  check("espaços em volta e barra no fim são ignorados", (await lastCrumb()) === "Pasta A");

  // --- relativos
  await go("sub");
  check("caminho relativo parte da pasta aberta", await waitFor(`[...document.querySelectorAll('#crumbs .crumb')].pop()?.textContent === 'sub'`));
  await go("..");
  check("'..' sobe um nível", await waitFor(`[...document.querySelectorAll('#crumbs .crumb')].pop()?.textContent === 'Pasta A'`));
  await go("..\\B");
  check("'..\\B' vai para a pasta irmã", await waitFor(`[...document.querySelectorAll('#crumbs .crumb')].pop()?.textContent === 'B'`));

  // --- arquivo: abre a pasta dele com ele selecionado
  await go(path.join(pastaA, "outro.txt"));
  check("um arquivo abre a pasta dele", await waitFor(`[...document.querySelectorAll('#crumbs .crumb')].pop()?.textContent === 'Pasta A'`));
  await sleep(200);
  check("e deixa o arquivo selecionado", (await selectedName()).includes("outro.txt"), await selectedName());

  // --- raiz do disco e "Este computador"
  const drive = root.slice(0, 2);
  await go(drive.toLowerCase());
  check("'d:' sozinho vai para a raiz do disco", await waitFor(`[...document.querySelectorAll('#crumbs .crumb')].pop()?.textContent === '${drive.toUpperCase()}'`), await crumbs());
  await go("este computador");
  check("'este computador' volta para a tela de discos", await waitFor(`document.getElementById('computer') && !document.getElementById('computer').hidden`));

  // --- erros: o campo continua aberto, com a mensagem
  await go(pastaA);
  await waitFor(`[...document.querySelectorAll('#crumbs .crumb')].pop()?.textContent === 'Pasta A'`);
  await go(path.join(root, "nao-existe"));
  await sleep(300);
  check("caminho inexistente mantém o campo aberto", await editing());
  check("e o marca como inválido", await invalid());
  check("com uma mensagem clara no status", /Não encontrei esse caminho/.test(await status()), await status());
  check("sem sair da pasta em que estava", (await lastCrumb()) === "Pasta A");
  await type("x");
  check("digitar de novo tira a marca de inválido", !(await invalid()));
  await ev(`document.getElementById('address').select()`);
  await type("   ");
  await press("Enter");
  await sleep(300);
  check("texto vazio pede um caminho", /Digite um caminho/.test(await status()) && (await editing()), await status());

  // --- teclas dentro do campo não vazam para a lista
  await ev(`document.getElementById('address').select()`);
  await type("abc");
  await press("Backspace");
  check("Backspace dentro do campo apaga o texto e não sobe de pasta", (await value()) === "ab" && (await editing()));
  await press("Escape");
  check("a pasta continua a mesma depois do Esc", (await lastCrumb()) === "Pasta A");

  // --- clicar fora cancela
  await openEdit();
  await ev(`document.getElementById('address').blur()`);
  await sleep(150);
  check("perder o foco cancela a edição", !(await editing()));

  // --- histórico
  await go("sub");
  await waitFor(`[...document.querySelectorAll('#crumbs .crumb')].pop()?.textContent === 'sub'`);
  await press("ArrowLeft", ALT);
  check("Alt+← volta para a pasta anterior ao caminho digitado", await waitFor(`[...document.querySelectorAll('#crumbs .crumb')].pop()?.textContent === 'Pasta A'`));
  await openEdit();
  await press("ArrowLeft", ALT);
  await sleep(300);
  check("navegar por atalho com o campo aberto fecha a edição", !(await editing()));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`pasta de teste removida? ${!fs.existsSync(root)}`);
}
finish();
