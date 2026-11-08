import type { EntryKind } from "./api.ts";

export type OpenAction = "folder" | "viewer" | "default";

/**
 * O que fazer ao abrir uma entrada (Enter ou duplo clique).
 *
 * Pasta sempre navega. Arquivo com visualizador próprio abre nele, a menos que o usuário tenha
 * pedido "Sempre abrir no app padrão"; sem visualizador próprio (Office, TIFF...), ou com a opção
 * ligada, vai para o app padrão do sistema.
 */
export function openAction(kind: EntryKind, hasViewer: boolean, alwaysDefault: boolean): OpenAction {
  if (kind === "dir") return "folder";
  if (kind === "file" && hasViewer && !alwaysDefault) return "viewer";
  return "default";
}
