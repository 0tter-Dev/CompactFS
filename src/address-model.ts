import type { Resolved } from "./api.ts";

export type Place = { kind: "computer" } | { kind: "dir"; path: string };

/** Texto que a barra de endereço mostra ao entrar em edição. */
export function addressText(place: Place | null): string {
  if (place?.kind === "dir") return place.path;
  return "Este computador";
}

/** Onde ir (e o que selecionar) para o que o núcleo resolveu: arquivo abre a pasta dele com ele selecionado. */
export function navigationTarget(resolved: Resolved): { place: Place; selectName: string | null } {
  switch (resolved.kind) {
    case "computer":
      return { place: { kind: "computer" }, selectName: null };
    case "dir":
      return { place: { kind: "dir", path: resolved.path }, selectName: null };
    case "file":
      return { place: { kind: "dir", path: resolved.parent }, selectName: resolved.name };
  }
}
