/**
 * Markdown básico (títulos, parágrafos, ênfase, código, citações, listas, tabelas, links e imagens
 * como texto), sem dependências.
 *
 * O conteúdo vem de arquivos não confiáveis, então: o resultado é uma árvore de dados (nunca HTML);
 * HTML embutido no markdown fica como texto; as varreduras são lineares e há limites de profundidade
 * e de trabalho total, para um arquivo hostil não conseguir travar a interface.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "del"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "image"; alt: string; src: string }
  | { t: "br" };

export type Align = "left" | "center" | "right" | null;

export interface ListItem {
  /** `null` = item comum; `true`/`false` = item de lista de tarefas (marcado ou não). */
  task: boolean | null;
  c: Block[];
}

export type Block =
  | { t: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: "para"; c: Inline[] }
  | { t: "code"; lang: string; v: string }
  | { t: "quote"; c: Block[] }
  | { t: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { t: "hr" }
  | { t: "table"; head: Inline[][]; align: Align[]; rows: Inline[][][] };

const MAX_BLOCK_DEPTH = 16;
const MAX_INLINE_DEPTH = 8;
/** Parágrafos maiores que isso não recebem formatação inline (evita trabalho quadrático). */
const MAX_INLINE_LENGTH = 10_000;
/** Orçamento total de varredura de delimitadores por documento. */
const WORK_BUDGET = 4_000_000;

interface Ctx {
  budget: number;
}

// ---------- utilidades de linha ----------

function indentOf(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n += 1;
    else if (ch === "\t") n += 4 - (n % 4);
    else break;
  }
  return n;
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/** Remove até `n` colunas de indentação. */
function stripIndent(line: string, n: number): string {
  let col = 0;
  let i = 0;
  while (i < line.length && col < n) {
    const ch = line[i];
    if (ch === " ") col += 1;
    else if (ch === "\t") col += 4 - (col % 4);
    else break;
    i += 1;
  }
  return line.slice(i);
}

function fenceOf(line: string): { char: string; len: number; lang: string; indent: number } | null {
  const indent = indentOf(line);
  if (indent > 3) return null;
  const s = line.trimStart();
  const ch = s[0];
  if (ch !== "`" && ch !== "~") return null;
  let len = 0;
  while (s[len] === ch) len += 1;
  if (len < 3) return null;
  const info = s.slice(len).trim();
  if (ch === "`" && info.includes("`")) return null;
  return { char: ch, len, lang: info.split(/\s/, 1)[0] ?? "", indent };
}

function headingOf(line: string): { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null {
  if (indentOf(line) > 3) return null;
  const s = line.trimStart();
  let level = 0;
  while (s[level] === "#") level += 1;
  if (level < 1 || level > 6) return null;
  if (s.length > level && s[level] !== " " && s[level] !== "\t") return null;
  let text = s.slice(level).trim();
  // Fecho opcional: "## título ##".
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end -= 1;
  if (end < text.length && (end === 0 || text[end - 1] === " ")) text = text.slice(0, end).trimEnd();
  return { level: level as 1 | 2 | 3 | 4 | 5 | 6, text };
}

function isHr(line: string): boolean {
  if (indentOf(line) > 3) return false;
  const s = line.replace(/[ \t]/g, "");
  if (s.length < 3) return false;
  const ch = s[0];
  if (ch !== "-" && ch !== "*" && ch !== "_") return false;
  for (const c of s) if (c !== ch) return false;
  return true;
}

interface Marker {
  ordered: boolean;
  start: number;
  /** Coluna onde começa o texto do item (indentação mínima das linhas de continuação). */
  contentIndent: number;
  markerIndent: number;
  rest: string;
}

function markerOf(line: string): Marker | null {
  const markerIndent = indentOf(line);
  if (markerIndent > 3) return null;
  const s = line.trimStart();
  let ordered = false;
  let start = 1;
  let markerLen = 0;
  const first = s[0];
  if (first === "-" || first === "*" || first === "+") {
    markerLen = 1;
  } else if (first !== undefined && first >= "0" && first <= "9") {
    let d = 0;
    while (d < s.length && s[d]! >= "0" && s[d]! <= "9") d += 1;
    if (d > 9 || (s[d] !== "." && s[d] !== ")")) return null;
    ordered = true;
    start = Number(s.slice(0, d));
    markerLen = d + 1;
  } else {
    return null;
  }
  const after = s.slice(markerLen);
  if (after !== "" && after[0] !== " " && after[0] !== "\t") return null;
  const rest = after.replace(/^[ \t]/, "");
  // "- " seguido de texto: a coluna do conteúdo é a do marcador + tamanho + 1.
  const spaces = rest.length - rest.trimStart().length;
  const gap = rest.trim() === "" ? 1 : Math.min(Math.max(spaces + 1, 1), 5);
  return {
    ordered,
    start,
    contentIndent: markerIndent + markerLen + gap,
    markerIndent,
    rest: rest.trimStart(),
  };
}

function startsBlock(line: string): boolean {
  return (
    fenceOf(line) !== null ||
    headingOf(line) !== null ||
    isHr(line) ||
    markerOf(line) !== null ||
    (indentOf(line) <= 3 && line.trimStart().startsWith(">"))
  );
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i += 1;
    } else if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

function alignOf(cell: string): Align | undefined {
  const c = cell.trim();
  if (c.length === 0) return undefined;
  const left = c.startsWith(":");
  const right = c.endsWith(":");
  const dashes = c.slice(left ? 1 : 0, right ? -1 : undefined);
  if (dashes.length === 0) return undefined;
  for (const ch of dashes) if (ch !== "-") return undefined;
  return left && right ? "center" : right ? "right" : left ? "left" : null;
}

function separatorRow(line: string | undefined): Align[] | null {
  if (line === undefined || !line.includes("-")) return null;
  const cells = splitRow(line);
  const aligns: Align[] = [];
  for (const cell of cells) {
    const a = alignOf(cell);
    if (a === undefined) return null;
    aligns.push(a);
  }
  return aligns;
}

// ---------- blocos ----------

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  return parseBlocks(lines, 0, { budget: WORK_BUDGET });
}

function plainParagraph(lines: string[]): Block[] {
  const text = lines.join("\n");
  return text.trim() === "" ? [] : [{ t: "para", c: [{ t: "text", v: text }] }];
}

function parseBlocks(lines: string[], depth: number, ctx: Ctx): Block[] {
  if (depth > MAX_BLOCK_DEPTH) return plainParagraph(lines);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i += 1;
      continue;
    }

    const fence = fenceOf(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const cur = lines[i]!;
        const close = fenceOf(cur);
        if (close && close.char === fence.char && close.len >= fence.len && cur.trim().replace(/[`~]/g, "") === "") {
          i += 1;
          break;
        }
        body.push(stripIndent(cur, fence.indent));
        i += 1;
      }
      blocks.push({ t: "code", lang: fence.lang, v: body.join("\n") });
      continue;
    }

    const heading = headingOf(line);
    if (heading) {
      blocks.push({ t: "heading", level: heading.level, c: parseInline(heading.text, 0, ctx) });
      i += 1;
      continue;
    }

    if (isHr(line)) {
      blocks.push({ t: "hr" });
      i += 1;
      continue;
    }

    if (indentOf(line) <= 3 && line.trimStart().startsWith(">")) {
      const inner: string[] = [];
      while (i < lines.length) {
        const cur = lines[i]!;
        if (indentOf(cur) <= 3 && cur.trimStart().startsWith(">")) {
          inner.push(cur.trimStart().slice(1).replace(/^ /, ""));
        } else if (!isBlank(cur) && inner.length > 0 && !isBlank(inner[inner.length - 1]!) && !startsBlock(cur)) {
          inner.push(cur); // continuação "preguiçosa" de um parágrafo
        } else {
          break;
        }
        i += 1;
      }
      blocks.push({ t: "quote", c: parseBlocks(inner, depth + 1, ctx) });
      continue;
    }

    const marker = markerOf(line);
    if (marker) {
      const list = parseList(lines, i, marker, depth, ctx);
      blocks.push(list.block);
      i = list.next;
      continue;
    }

    const head = line.includes("|") ? splitRow(line) : null;
    const aligns = head ? separatorRow(lines[i + 1]) : null;
    if (head && aligns && aligns.length === head.length) {
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && !isBlank(lines[i]!) && lines[i]!.includes("|")) {
        const cells = splitRow(lines[i]!);
        rows.push(head.map((_, c) => parseInline(cells[c] ?? "", 0, ctx)));
        i += 1;
      }
      blocks.push({ t: "table", head: head.map((c) => parseInline(c, 0, ctx)), align: aligns, rows });
      continue;
    }

    if (indentOf(line) >= 4) {
      const body: string[] = [];
      while (i < lines.length && (isBlank(lines[i]!) || indentOf(lines[i]!) >= 4)) {
        body.push(stripIndent(lines[i]!, 4));
        i += 1;
      }
      while (body.length > 0 && isBlank(body[body.length - 1]!)) body.pop();
      blocks.push({ t: "code", lang: "", v: body.join("\n") });
      continue;
    }

    // Parágrafo (ou título "setext": texto seguido de === ou ---).
    const para: string[] = [];
    let setext: 1 | 2 | null = null;
    while (i < lines.length) {
      const cur = lines[i]!;
      if (isBlank(cur)) break;
      if (para.length > 0) {
        const t = cur.trim();
        if (/^=+$/.test(t)) {
          setext = 1;
          i += 1;
          break;
        }
        if (/^-+$/.test(t)) {
          setext = 2;
          i += 1;
          break;
        }
        if (startsBlock(cur)) break;
      }
      // Só o começo da linha é aparado: os dois espaços do fim marcam uma quebra forçada.
      para.push(cur.trimStart());
      i += 1;
    }
    const text = para.join("\n").trimEnd();
    blocks.push(
      setext
        ? { t: "heading", level: setext, c: parseInline(text, 0, ctx) }
        : { t: "para", c: parseInline(text, 0, ctx) },
    );
  }
  return blocks;
}

function parseList(
  lines: string[],
  from: number,
  first: Marker,
  depth: number,
  ctx: Ctx,
): { block: Block; next: number } {
  const items: ListItem[] = [];
  let i = from;
  let marker: Marker | null = first;

  while (marker && marker.ordered === first.ordered) {
    const body: string[] = [marker.rest];
    i += 1;
    let sawBlank = false;
    while (i < lines.length) {
      const cur = lines[i]!;
      if (isBlank(cur)) {
        sawBlank = true;
        body.push("");
        i += 1;
        continue;
      }
      if (indentOf(cur) >= marker.contentIndent) {
        body.push(stripIndent(cur, marker.contentIndent));
        sawBlank = false;
        i += 1;
        continue;
      }
      // Linha menos indentada: é outro item, fim da lista, ou continuação preguiçosa do parágrafo.
      if (!sawBlank && !startsBlock(cur) && !isBlank(body[body.length - 1] ?? "")) {
        body.push(cur.trim());
        i += 1;
        continue;
      }
      break;
    }
    while (body.length > 0 && isBlank(body[body.length - 1]!)) body.pop();

    let task: boolean | null = null;
    const head = body[0] ?? "";
    const m = /^\[([ xX])\](?:[ \t]|$)/.exec(head);
    if (m) {
      task = m[1] !== " ";
      body[0] = head.slice(m[0].length);
    }
    items.push({ task, c: parseBlocks(body, depth + 1, ctx) });

    const next: string | undefined = lines[i];
    marker = next !== undefined ? markerOf(next) : null;
    // "* * *" parece um marcador de lista, mas é uma linha horizontal e encerra a lista.
    if (marker && isHr(next!)) marker = null;
  }
  return { block: { t: "list", ordered: first.ordered, start: first.start, items }, next: i };
}

// ---------- inline ----------

const PUNCTUATION = "\\`*_{}[]()#+-.!|~<>\"'&:;/=?@$%^,";

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || ch === " " || ch === "\n" || ch === "\t";
}

/** Procura `delim` a partir de `from`, gastando do orçamento o que varrer. */
function findClosing(text: string, delim: string, from: number, ctx: Ctx): number {
  const at = text.indexOf(delim, from);
  ctx.budget -= (at < 0 ? text.length : at) - from + 1;
  return at;
}

function parseInline(text: string, depth: number, ctx: Ctx): Inline[] {
  if (text.length > MAX_INLINE_LENGTH || depth > MAX_INLINE_DEPTH || ctx.budget <= 0) {
    return text === "" ? [] : [{ t: "text", v: text }];
  }
  const out: Inline[] = [];
  let buf = "";
  const flush = (): void => {
    if (buf !== "") {
      out.push({ t: "text", v: buf });
      buf = "";
    }
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;

    if (ch === "\\" && i + 1 < text.length) {
      const next = text[i + 1]!;
      if (next === "\n") {
        flush();
        out.push({ t: "br" });
        i += 2;
        continue;
      }
      if (PUNCTUATION.includes(next)) {
        buf += next;
        i += 2;
        continue;
      }
    }

    if (ch === "\n") {
      const spaces = trailingSpaces(buf);
      if (spaces >= 2) {
        buf = buf.slice(0, buf.length - spaces);
        flush();
        out.push({ t: "br" });
      } else {
        buf = buf.slice(0, buf.length - spaces) + "\n";
      }
      i += 1;
      continue;
    }

    if (ch === "`") {
      let run = 0;
      while (text[i + run] === "`") run += 1;
      const fence = "`".repeat(run);
      let close = findClosing(text, fence, i + run, ctx);
      // O fecho tem de ter exatamente o mesmo número de crases.
      while (close >= 0 && (text[close + run] === "`" || text[close - 1] === "`")) {
        close = findClosing(text, fence, close + 1, ctx);
      }
      if (close >= 0) {
        flush();
        let code = text.slice(i + run, close).replace(/\n/g, " ");
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "") code = code.slice(1, -1);
        out.push({ t: "code", v: code });
        i = close + run;
      } else {
        buf += fence;
        i += run;
      }
      continue;
    }

    if (ch === "!" || ch === "[") {
      const link = parseLink(text, ch === "!" ? i + 1 : i, ctx);
      if (link && (ch === "[" || text[i + 1] === "[")) {
        flush();
        out.push(
          ch === "!"
            ? { t: "image", alt: link.label, src: link.href }
            : { t: "link", href: link.href, c: parseInline(link.label, depth + 1, ctx) },
        );
        i = link.end;
        continue;
      }
    }

    if (ch === "<") {
      const close = text.indexOf(">", i + 1);
      const inner = close > i ? text.slice(i + 1, close) : "";
      if (/^https?:\/\/[^\s<>]+$/.test(inner)) {
        flush();
        out.push({ t: "link", href: inner, c: [{ t: "text", v: inner }] });
        i = close + 1;
        continue;
      }
    }

    if (ch === "*" || ch === "_" || ch === "~") {
      let run = 0;
      while (text[i + run] === ch) run += 1;
      const len = ch === "~" ? (run >= 2 ? 2 : 0) : Math.min(run, 2);
      const before = i > 0 ? text[i - 1] : undefined;
      const after = text[i + run];
      // Abre se o que vem depois não é espaço; "_" não abre no meio de uma palavra.
      const canOpen = len > 0 && !isSpace(after) && !(ch === "_" && isWordChar(before));
      if (canOpen) {
        const delim = ch.repeat(len);
        const bodyStart = i + len;
        let close = findClosing(text, delim, bodyStart, ctx);
        while (close >= 0 && (isSpace(text[close - 1]) || (ch === "_" && isWordChar(text[close + len])) || close === bodyStart)) {
          close = findClosing(text, delim, close + 1, ctx);
        }
        if (close > bodyStart) {
          flush();
          const kids = parseInline(text.slice(bodyStart, close), depth + 1, ctx);
          out.push(ch === "~" ? { t: "del", c: kids } : len === 2 ? { t: "strong", c: kids } : { t: "em", c: kids });
          i = close + len;
          continue;
        }
      }
      buf += ch.repeat(run);
      i += run;
      continue;
    }

    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

/** `[rótulo](destino "título")`, a partir do `[` em `start`. Varredura linear, com colchetes aninhados. */
function parseLink(
  text: string,
  start: number,
  ctx: Ctx,
): { label: string; href: string; end: number } | null {
  if (text[start] !== "[") return null;
  let level = 0;
  let i = start;
  for (; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\") i += 1;
    else if (ch === "[") level += 1;
    else if (ch === "]") {
      level -= 1;
      if (level === 0) break;
    }
  }
  ctx.budget -= i - start;
  if (level !== 0 || text[i + 1] !== "(") return null;
  const label = text.slice(start + 1, i);
  let j = i + 2;
  let depth = 1;
  let href = "";
  for (; j < text.length; j += 1) {
    const ch = text[j]!;
    if (ch === "\\" && j + 1 < text.length) {
      href += text[j + 1];
      j += 1;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) break;
    } else if (ch === "\n") {
      return null;
    }
    href += ch;
  }
  ctx.budget -= j - i;
  if (depth !== 0) return null;
  const url = stripLinkTitle(href.trim());
  return { label, href: url.startsWith("<") && url.endsWith(">") ? url.slice(1, -1) : url, end: j + 1 };
}

/** Número de espaços no fim de `s` (varredura de trás para a frente: linear). */
function trailingSpaces(s: string): number {
  let n = 0;
  while (n < s.length && s[s.length - 1 - n] === " ") n += 1;
  return n;
}

/** Remove o título opcional de um destino de link: `url "título"` ou `url 'título'`. */
function stripLinkTitle(s: string): string {
  const quote = s[s.length - 1];
  if (quote !== '"' && quote !== "'") return s;
  const open = s.lastIndexOf(quote, s.length - 2);
  if (open <= 0 || (s[open - 1] !== " " && s[open - 1] !== "\t")) return s;
  return s.slice(0, open).trimEnd();
}
