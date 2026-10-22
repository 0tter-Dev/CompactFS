import { invoke } from "@tauri-apps/api/core";
import "./style.css";

interface AppInfo {
  name: string;
  version: string;
  startupMs: number;
}

async function main(): Promise<void> {
  const status = document.querySelector<HTMLParagraphElement>("#status");
  if (!status) return;
  const info = await invoke<AppInfo>("app_info");
  status.textContent = `${info.name} v${info.version}: interface pronta em ${info.startupMs} ms`;
}

main().catch((err) => {
  const status = document.querySelector<HTMLParagraphElement>("#status");
  if (status) status.textContent = `Erro ao iniciar: ${String(err)}`;
});
