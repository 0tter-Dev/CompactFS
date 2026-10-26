/** Título do cartão de um disco: "SATA 1TB (D:)" no Windows, só o nome no Android ("Armazenamento interno"). */
export function driveTitle(path: string, label: string | null): string {
  const root = path.replace(/[\\/]+$/, "");
  const isDriveLetter = /^[A-Za-z]:$/.test(root);
  if (isDriveLetter) return label ? `${label} (${root})` : root;
  return label ?? root;
}
