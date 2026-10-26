// Ajudante dos testes de ponta a ponta: dirige o app real pelo protocolo de depuração do WebView2.
// Sem dependências (usa o WebSocket e o fetch do Node 24). Não roda na CI.
//
// Como rodar (PowerShell), com o app aberto assim:
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
//   $env:WEBVIEW2_USER_DATA_FOLDER = "$env:TEMP\compactfs-e2e"   # perfil separado do uso normal
//   .\src-tauri\target\release\compactfs.exe
//   node e2e\address.mjs

const PORT = process.env.CDP_PORT ?? "9222";

export async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("nenhuma página encontrada: o app está aberto com --remote-debugging-port?");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method === "Runtime.exceptionThrown") {
      errors.push(m.params.exceptionDetails?.exception?.description ?? "exceção");
    } else if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
      errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    }
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send("Runtime.enable");

  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " " + expression);
    return r.result.result.value;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (expr, ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await ev(expr)) return true;
      await sleep(40);
    }
    return false;
  };

  const KEYS = {
    Enter: [13, "Enter"],
    Escape: [27, "Escape"],
    Backspace: [8, "Backspace"],
    F4: [115, "F4"],
    ArrowLeft: [37, "ArrowLeft"],
    l: [76, "KeyL"],
    d: [68, "KeyD"],
  };
  /** Pressiona uma tecla. `mods`: alt=1, ctrl=2, meta=4, shift=8. */
  const press = async (key, mods = 0) => {
    const [vk, code] = KEYS[key];
    const base = { key, code, windowsVirtualKeyCode: vk, modifiers: mods };
    await send("Input.dispatchKeyEvent", { type: "keyDown", ...base });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  };
  /** Digita texto no elemento focado, substituindo o que estiver selecionado. */
  const type = (text) => send("Input.insertText", { text });

  const results = [];
  const check = (name, ok, detail = "") => {
    results.push(ok);
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  [${detail}]` : ""}`);
  };
  const finish = () => {
    check("nenhum erro nem aviso no console", errors.length === 0, errors.slice(0, 2).join(" | "));
    const failed = results.filter((r) => !r).length;
    console.log(`\n${results.length - failed}/${results.length} verificações passaram`);
    ws.close();
    process.exit(failed === 0 ? 0 : 1);
  };
  return { ev, send, sleep, waitFor, press, type, check, finish, errors };
}
