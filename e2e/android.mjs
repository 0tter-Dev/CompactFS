// Teste de ponta a ponta do app no Android, dirigindo o WebView do aparelho pelo depurador.
// Somente leitura: não cria, altera nem apaga nada no aparelho. Não roda na CI.
//
// Como rodar (PowerShell), com o aparelho conectado por USB e a depuração USB ligada, e o APK de
// DEPURAÇÃO instalado e aberto (o de lançamento não expõe o depurador):
//   $adb = "<SDK>\platform-tools\adb.exe"
//   $pid = (& $adb shell pidof dev.otterdev.compactfs).Trim()
//   & $adb forward tcp:9223 "localabstract:webview_devtools_remote_$pid"
//   $env:CDP_PORT = "9223"
//   node e2e\android.mjs [--image /storage/emulated/0/Download/foto.jpg] [--pdf /storage/emulated/0/Download/a.pdf]
// (no Git Bash use `MSYS_NO_PATHCONV=1` na frente, senão os caminhos que começam com / são reescritos)
//
// `--image` e `--pdf` apontam para arquivos que já existem no aparelho; sem eles, essas verificações
// são puladas. O "Acesso a todos os arquivos" precisa estar concedido ao app.

import { connect } from "./cdp.mjs";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const imagePath = arg("--image");
const pdfPath = arg("--pdf");

const { ev, sleep, waitFor, press, type, check, finish } = await connect();
const invoke = (cmd, payload = {}) =>
  ev(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(payload)}).then(v => ({ ok: v }), e => ({ err: e }))`);
const lastCrumb = () => ev(`[...document.querySelectorAll('#crumbs .crumb')].pop()?.textContent`);
const crumbs = () => ev(`[...document.querySelectorAll('#crumbs .crumb')].map(b => b.textContent).join(' > ')`);
const tileNames = () => ev(`[...document.querySelectorAll('#grid .tile .tname')].map(n => n.textContent.trim())`);
/** Duplo toque no tile `name`. A grade é virtualizada: só os tiles perto da tela existem, então rola até achar. */
const openTile = async (name) => {
  for (let i = 0; i < 60; i++) {
    const found = await ev(`(() => { const t = [...document.querySelectorAll('#grid .tile')].find(t => t.querySelector('.tname')?.textContent.trim() === ${JSON.stringify(name)}); if (!t) return false; t.scrollIntoView(); t.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true; })()`);
    if (found) return true;
    const moved = await ev(`(() => { const g = document.getElementById('grid'); const before = g.scrollTop; g.scrollTop += Math.max(200, g.clientHeight * 0.8); return g.scrollTop > before; })()`);
    await sleep(250);
    if (!moved) return false;
  }
  return false;
};
const baseName = (p) => p.split("/").pop();
const dirName = (p) => p.slice(0, p.lastIndexOf("/"));

// --- acesso a todos os arquivos
const access = await invoke("storage_access");
check("o plugin Kotlin responde sobre o acesso a todos os arquivos", access.ok?.supported === true, JSON.stringify(access));
check("o acesso a todos os arquivos está concedido (conceda nas configurações se falhar)", access.ok?.granted === true);
check("com o acesso concedido a faixa de pedido fica escondida", await ev(`document.getElementById('access-banner').hidden`));

// --- armazenamentos
await waitFor(`document.querySelector('.drive') !== null`, 8000);
const card = await ev(`document.querySelector('.drive')?.innerText.replace(/\\n/g, ' | ')`);
check("'Este computador' mostra o Armazenamento interno com o espaço livre", /Armazenamento interno/.test(card) && /livres de/.test(card), card);
await ev(`document.querySelector('.drive').click()`);
await waitFor(`[...document.querySelectorAll('#crumbs .crumb')].pop()?.textContent === 'Armazenamento interno'`, 8000);
await sleep(400);
check("a trilha começa no nome do armazenamento", (await crumbs()) === "Este computador > Armazenamento interno", await crumbs());
await ev(`document.getElementById('up').click()`);
await sleep(600);
check("Subir na raiz do armazenamento volta para 'Este computador'", await ev(`!document.getElementById('computer').hidden`));
await ev(`document.querySelector('.drive').click()`);
await waitFor(`[...document.querySelectorAll('#crumbs .crumb')].pop()?.textContent === 'Armazenamento interno'`, 8000);
await sleep(400);

// --- barra superior em tela estreita
const overflow = await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
check("a página não passa da largura da tela", overflow <= 0, `excesso de ${overflow}px`);
check("a busca mostra 'Buscar' (sem Ctrl+F) no toque", (await ev(`document.getElementById('search').placeholder`)) === "Buscar");

// --- arquivos e visualizadores
if (imagePath || pdfPath) {
  const folder = dirName(imagePath ?? pdfPath);
  // navega até a pasta pelos toques, nível a nível
  const levels = folder.replace("/storage/emulated/0/", "").split("/").filter(Boolean);
  for (const level of levels) {
    await sleep(500);
    const ok = await openTile(level);
    check(`abre a pasta ${level} pelo toque`, ok);
    if (!ok) break;
    await waitFor(`[...document.querySelectorAll('#crumbs .crumb')].pop()?.textContent === ${JSON.stringify(level)}`, 6000);
  }
  await sleep(2500);
}
if (imagePath) {
  const painted = await ev(`(() => { const t = [...document.querySelectorAll('#grid .tile')].find(t => t.querySelector('.tname')?.textContent.trim() === ${JSON.stringify(baseName(imagePath))}); const c = t?.querySelector('canvas'); if (!c || c.width === 0) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true; return false; })()`);
  check("a imagem ganha miniatura real na galeria", painted === true);
  await openTile(baseName(imagePath));
  await waitFor(`document.querySelector('#viewer-body img') !== null`, 6000);
  await sleep(1500);
  check("o visualizador abre a imagem", await ev(`(() => { const i = document.querySelector('#viewer-body img'); return !!i && i.complete && i.naturalWidth > 0; })()`));
  await press("Escape");
  await sleep(500);
}
if (pdfPath) {
  const info = await invoke("pdf_info", { path: pdfPath });
  check("o plugin Kotlin conta as páginas do PDF", (info.ok?.pages ?? 0) >= 1, JSON.stringify(info));
  await openTile(baseName(pdfPath));
  await waitFor(`document.querySelector('#viewer-body .pdf-pages') !== null`, 8000);
  await waitFor(`[...document.querySelectorAll('#viewer-body .pdf-pages canvas')].some(c => c.width > 0)`, 15000);
  const dark = await ev(`(() => { const c = [...document.querySelectorAll('#viewer-body .pdf-pages canvas')].find(c => c.width > 0); if (!c) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++; return n; })()`);
  check("o PDF é desenhado em páginas, com conteúdo (não em branco)", dark > 500, `${dark} pixels escuros`);
  check("a página cabe na largura da tela", (await ev(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)) <= 0);
  await press("Escape");
  await sleep(500);
}

// --- busca
const searchName = imagePath ? baseName(imagePath).slice(0, 8) : null;
if (searchName) {
  await ev(`(() => { const s = document.getElementById('search'); s.focus(); s.select(); })()`);
  await type(searchName);
  await press("Enter");
  const done = await waitFor(`/resultado/.test(document.getElementById('status-main').textContent) && /examinada/.test(document.getElementById('status-main').textContent)`, 20000);
  const status = await ev(`document.getElementById('status-main').textContent`);
  check("a busca por nome acha o arquivo e informa as pastas examinadas", done && /^[1-9]/.test(status), status);
  await press("Escape");
}

finish();
