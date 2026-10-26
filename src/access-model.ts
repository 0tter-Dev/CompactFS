import type { StorageAccess } from "./api.ts";

/** A faixa de pedido só aparece onde há o que pedir (Android 11+) e a permissão ainda não foi dada. */
export function needsAccessPrompt(access: StorageAccess): boolean {
  return access.supported && !access.granted;
}
