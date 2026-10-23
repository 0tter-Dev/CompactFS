import { formatCount, plural } from "./format.ts";
import type { SearchSummary } from "./api.ts";

/** A busca roda sozinha a partir deste número de caracteres (com menos, só ao apertar Enter). */
export const MIN_AUTO_CHARS = 2;

/** Conta caracteres de verdade (um emoji conta como um), e ignora espaços nas pontas. */
export function shouldAutoSearch(text: string): boolean {
  return [...text.trim()].length >= MIN_AUTO_CHARS;
}

function withoutTrailingSeparator(path: string, separator: string): string {
  return path.length > 1 && path.endsWith(separator) ? path.slice(0, -separator.length) : path;
}

/**
 * Pasta de um resultado relativa à pasta onde a busca começou, para mostrar de onde ele veio.
 * Vazio se o resultado está na própria pasta de partida.
 */
export function relativeDir(root: string, dir: string, separator: string): string {
  const r = withoutTrailingSeparator(root, separator);
  const d = withoutTrailingSeparator(dir, separator);
  if (d === r) return "";
  // A raiz "/" já termina em separador; as demais ganham um para não casar "fotos2" com "fotos".
  const prefix = r.endsWith(separator) ? r : r + separator;
  if (d.startsWith(prefix)) return d.slice(prefix.length);
  return dir;
}

/** Último nível de um caminho (`D:\fotos\2024` vira `2024`; a raiz `D:\` vira `D:`). */
export function lastSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p !== "");
  return parts.length > 0 ? (parts[parts.length - 1] as string) : path;
}

export interface SearchProgress {
  query: string;
  matches: number;
  scannedDirs: number;
  /** `null` enquanto a busca ainda anda. */
  summary: SearchSummary | null;
}

export function searchStatus(p: SearchProgress): string {
  const s = p.summary;
  if (!s) {
    return `Buscando “${p.query}”… ${plural(p.matches, "resultado", "resultados")} · ${plural(p.scannedDirs, "pasta examinada", "pastas examinadas")}`;
  }
  const parts = [
    s.matches === 0
      ? `Nenhum resultado para “${p.query}”`
      : `${plural(s.matches, "resultado", "resultados")} para “${p.query}”`,
    `${plural(s.scannedDirs, "pasta examinada", "pastas examinadas")} em ${formatCount(s.elapsedMs)} ms`,
  ];
  if (s.truncated) parts.push(`mostrando só os primeiros ${formatCount(s.matches)}: refine a busca`);
  if (s.skippedDirs > 0) {
    parts.push(plural(s.skippedDirs, "pasta sem acesso ignorada", "pastas sem acesso ignoradas"));
  }
  if (s.cancelled) parts.push("busca interrompida");
  return parts.join(" · ");
}
