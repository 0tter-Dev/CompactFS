const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("pt-BR");
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Tamanho legível, base 1024 (como o Explorer do Windows): `1536` vira `1,5 KB`. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? integer.format(value) : decimal.format(value)} ${UNITS[unit]}`;
}

export function formatCount(n: number): string {
  return integer.format(n);
}

/** "1 item" / "2 itens", com separador de milhar. */
export function plural(n: number, one: string, many: string): string {
  return `${integer.format(n)} ${n === 1 ? one : many}`;
}

export function formatDate(ms: number | null): string {
  return ms === null ? "" : dateTime.format(new Date(ms));
}

/** Junta pasta e nome com o separador do sistema, sem duplicar o separador na raiz (`D:\`). */
export function joinPath(dir: string, name: string, separator: string): string {
  return dir.endsWith(separator) || dir.endsWith("/") ? `${dir}${name}` : `${dir}${separator}${name}`;
}
