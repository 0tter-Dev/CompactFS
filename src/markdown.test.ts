import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdown, type Block, type Inline } from "./markdown.ts";

const text = (v: string): Inline => ({ t: "text", v });

function paragraph(source: string): Inline[] {
  const [b] = parseMarkdown(source);
  assert.equal(b?.t, "para", `esperava parágrafo para ${JSON.stringify(source)}, veio ${JSON.stringify(b)}`);
  return (b as Extract<Block, { t: "para" }>).c;
}

test("títulos com # (de 1 a 6) e com fecho opcional", () => {
  assert.deepEqual(parseMarkdown("# Um"), [{ t: "heading", level: 1, c: [text("Um")] }]);
  assert.deepEqual(parseMarkdown("###### Seis"), [{ t: "heading", level: 6, c: [text("Seis")] }]);
  assert.deepEqual(parseMarkdown("## Dois ##"), [{ t: "heading", level: 2, c: [text("Dois")] }]);
  // 7 jogos da velha ou sem espaço não são título.
  assert.equal(parseMarkdown("####### sete")[0]?.t, "para");
  assert.equal(parseMarkdown("#semespaco")[0]?.t, "para");
});

test("títulos 'setext' (sublinhados com = e -)", () => {
  assert.deepEqual(parseMarkdown("Título\n====="), [{ t: "heading", level: 1, c: [text("Título")] }]);
  assert.deepEqual(parseMarkdown("Sub\n---"), [{ t: "heading", level: 2, c: [text("Sub")] }]);
});

test("parágrafos juntam linhas seguidas e se separam por linha em branco", () => {
  const blocks = parseMarkdown("linha um\nlinha dois\n\noutro");
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { t: "para", c: [text("linha um\nlinha dois")] });
});

test("ênfase: negrito, itálico e tachado, com os dois delimitadores", () => {
  assert.deepEqual(paragraph("**negrito** e __negrito__"), [
    { t: "strong", c: [text("negrito")] },
    text(" e "),
    { t: "strong", c: [text("negrito")] },
  ]);
  assert.deepEqual(paragraph("*it* e _it_"), [{ t: "em", c: [text("it")] }, text(" e "), { t: "em", c: [text("it")] }]);
  assert.deepEqual(paragraph("~~riscado~~"), [{ t: "del", c: [text("riscado")] }]);
  assert.deepEqual(paragraph("**a *b* c**"), [{ t: "strong", c: [text("a "), { t: "em", c: [text("b")] }, text(" c")] }]);
});

test("asteriscos soltos, multiplicação e sublinhado no meio de palavra ficam como texto", () => {
  assert.deepEqual(paragraph("2 * 3 * 4"), [text("2 * 3 * 4")]);
  assert.deepEqual(paragraph("snake_case_name"), [text("snake_case_name")]);
  assert.deepEqual(paragraph("**sem fecho"), [text("**sem fecho")]);
  assert.deepEqual(paragraph("a ** b"), [text("a ** b")]);
});

test("código inline, inclusive com crases dentro", () => {
  assert.deepEqual(paragraph("use `npm i`"), [text("use "), { t: "code", v: "npm i" }]);
  assert.deepEqual(paragraph("``a ` b``"), [{ t: "code", v: "a ` b" }]);
  assert.deepEqual(paragraph("`sem fecho"), [text("`sem fecho")]);
});

test("código dentro de ênfase não é interpretado", () => {
  assert.deepEqual(paragraph("`**x**`"), [{ t: "code", v: "**x**" }]);
});

test("blocos de código com cerca (``` e ~~~), com linguagem e sem fecho", () => {
  assert.deepEqual(parseMarkdown("```rust\nfn main() {}\n```"), [{ t: "code", lang: "rust", v: "fn main() {}" }]);
  assert.deepEqual(parseMarkdown("~~~\na\nb\n~~~"), [{ t: "code", lang: "", v: "a\nb" }]);
  // Sem fecho: vai até o fim do arquivo, sem travar.
  assert.deepEqual(parseMarkdown("```\ntexto\nmais"), [{ t: "code", lang: "", v: "texto\nmais" }]);
  // Dentro da cerca nada é interpretado.
  assert.deepEqual(parseMarkdown("```\n# não é título\n**nem negrito**\n```"), [
    { t: "code", lang: "", v: "# não é título\n**nem negrito**" },
  ]);
});

test("código por indentação", () => {
  assert.deepEqual(parseMarkdown("    a\n    b"), [{ t: "code", lang: "", v: "a\nb" }]);
});

test("citações, inclusive aninhadas", () => {
  assert.deepEqual(parseMarkdown("> oi"), [{ t: "quote", c: [{ t: "para", c: [text("oi")] }] }]);
  const nested = parseMarkdown("> a\n> > b");
  assert.equal(nested[0]?.t, "quote");
  const inner = (nested[0] as Extract<Block, { t: "quote" }>).c;
  assert.equal(inner[1]?.t, "quote");
});

test("listas com marcadores e numeradas, com início personalizado", () => {
  const bullets = parseMarkdown("- a\n- b\n- c");
  assert.equal(bullets[0]?.t, "list");
  const list = bullets[0] as Extract<Block, { t: "list" }>;
  assert.equal(list.ordered, false);
  assert.equal(list.items.length, 3);
  const ordered = parseMarkdown("3. x\n4. y")[0] as Extract<Block, { t: "list" }>;
  assert.deepEqual([ordered.ordered, ordered.start, ordered.items.length], [true, 3, 2]);
});

test("listas aninhadas e itens com vários parágrafos", () => {
  const list = parseMarkdown("- pai\n  - filho\n  - filho 2\n- irmão")[0] as Extract<Block, { t: "list" }>;
  assert.equal(list.items.length, 2);
  const kids = list.items[0]!.c;
  assert.equal(kids[0]?.t, "para");
  assert.equal(kids[1]?.t, "list");
  assert.equal((kids[1] as Extract<Block, { t: "list" }>).items.length, 2);

  const loose = parseMarkdown("- um\n\n  continuação\n- dois")[0] as Extract<Block, { t: "list" }>;
  assert.equal(loose.items[0]!.c.length, 2);
});

test("lista de tarefas marca os itens concluídos", () => {
  const list = parseMarkdown("- [x] feito\n- [ ] pendente\n- comum")[0] as Extract<Block, { t: "list" }>;
  assert.deepEqual(list.items.map((i) => i.task), [true, false, null]);
  assert.deepEqual(list.items[0]!.c, [{ t: "para", c: [text("feito")] }]);
});

test("linha horizontal não vira item de lista", () => {
  assert.deepEqual(parseMarkdown("---"), [{ t: "hr" }]);
  assert.deepEqual(parseMarkdown("* * *"), [{ t: "hr" }]);
  assert.deepEqual(parseMarkdown("antes\n\n___\n\ndepois").map((b) => b.t), ["para", "hr", "para"]);
});

test("tabelas, com alinhamento e linhas incompletas", () => {
  const [table] = parseMarkdown("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n| só |");
  assert.equal(table?.t, "table");
  const t = table as Extract<Block, { t: "table" }>;
  assert.deepEqual(t.align, ["left", "center", "right"]);
  assert.equal(t.head.length, 3);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[1]!.length, 3, "linha curta é completada com células vazias");
  assert.deepEqual(t.rows[0]![1], [text("2")]);
});

test("uma linha com | sem separador embaixo continua sendo parágrafo", () => {
  assert.equal(parseMarkdown("a | b\nc")[0]?.t, "para");
});

test("tabela exige o mesmo número de colunas no cabeçalho e no separador", () => {
  // Separador com menos colunas que o cabeçalho: não é tabela.
  assert.equal(parseMarkdown("| a | b |\n|---|")[0]?.t, "para");
  assert.equal(parseMarkdown("| a |\n|---|---|")[0]?.t, "para");
  assert.equal(parseMarkdown("| a | b |\n|---|---|")[0]?.t, "table");
});

test("cerca de código só fecha com cerca do mesmo tipo e de tamanho suficiente", () => {
  // Cerca de 4 crases: uma de 3 dentro dela não fecha.
  assert.deepEqual(parseMarkdown("````\n```\ndentro\n```\n````"), [{ t: "code", lang: "", v: "```\ndentro\n```" }]);
  // Cerca de crases não fecha com til.
  assert.deepEqual(parseMarkdown("```\na\n~~~\nb\n```"), [{ t: "code", lang: "", v: "a\n~~~\nb" }]);
});

test("sublinhado no meio de uma palavra não vira ênfase, mesmo que o fim seja livre", () => {
  assert.deepEqual(paragraph("foo_bar_ baz"), [text("foo_bar_ baz")]);
  assert.deepEqual(paragraph("_ok_ foo_bar_"), [{ t: "em", c: [text("ok")] }, text(" foo_bar_")]);
});

test("linha horizontal depois de uma lista encerra a lista", () => {
  const blocks = parseMarkdown("- a\n- b\n* * *\ntexto");
  assert.deepEqual(blocks.map((b) => b.t), ["list", "hr", "para"]);
  assert.equal((blocks[0] as Extract<Block, { t: "list" }>).items.length, 2);
});

test("itens aninhados e irmãos continuam corretos", () => {
  const list = parseMarkdown("- pai\n  - filho\n- irmão\n  - filho 2")[0] as Extract<Block, { t: "list" }>;
  assert.equal(list.items.length, 2);
  assert.equal((list.items[0]!.c[1] as Extract<Block, { t: "list" }>).items.length, 1);
  assert.equal((list.items[1]!.c[1] as Extract<Block, { t: "list" }>).items.length, 1);
});

test("links e imagens guardam o destino, mas só como dado", () => {
  assert.deepEqual(paragraph("[site](https://exemplo.com)"), [{ t: "link", href: "https://exemplo.com", c: [text("site")] }]);
  assert.deepEqual(paragraph('[t](https://a.com "título")'), [{ t: "link", href: "https://a.com", c: [text("t")] }]);
  assert.deepEqual(paragraph("![logo](img/logo.png)"), [{ t: "image", alt: "logo", src: "img/logo.png" }]);
  assert.deepEqual(paragraph("<https://a.com>"), [{ t: "link", href: "https://a.com", c: [text("https://a.com")] }]);
  assert.deepEqual(paragraph("[sem destino] e [x](quebrado"), [text("[sem destino] e [x](quebrado")]);
  assert.deepEqual(paragraph("[a](https://x.com/(b))"), [{ t: "link", href: "https://x.com/(b)", c: [text("a")] }]);
});

test("quebra de linha forçada (dois espaços ou barra no fim)", () => {
  assert.deepEqual(paragraph("a  \nb"), [text("a"), { t: "br" }, text("b")]);
  assert.deepEqual(paragraph("a\\\nb"), [text("a"), { t: "br" }, text("b")]);
  assert.deepEqual(paragraph("a\nb"), [text("a\nb")]);
});

test("escapes com barra invertida", () => {
  assert.deepEqual(paragraph("\\*não é ênfase\\*"), [text("*não é ênfase*")]);
  assert.deepEqual(paragraph("a \\# b"), [text("a # b")]);
  assert.deepEqual(paragraph("c:\\pasta"), [text("c:\\pasta")]);
});

test("HTML embutido não é interpretado: vira texto", () => {
  const inline = paragraph("<script>alert(1)</script> <img src=x onerror=alert(1)>");
  assert.ok(inline.every((n) => n.t === "text"), JSON.stringify(inline));
  assert.equal(parseMarkdown("<div onclick=x>oi</div>")[0]?.t, "para");
  // Um destino 'javascript:' é só um texto guardado; quem desenha nunca o usa como endereço.
  assert.deepEqual(paragraph("[x](javascript:alert(1))"), [{ t: "link", href: "javascript:alert(1)", c: [text("x")] }]);
});

test("CRLF, arquivo vazio e só espaços", () => {
  assert.deepEqual(parseMarkdown("# a\r\n\r\ntexto"), [
    { t: "heading", level: 1, c: [text("a")] },
    { t: "para", c: [text("texto")] },
  ]);
  assert.deepEqual(parseMarkdown(""), []);
  assert.deepEqual(parseMarkdown("   \n\t\n"), []);
});

test("um documento real, misturando tudo", () => {
  const doc = [
    "# Projeto",
    "",
    "Texto com **negrito**, *itálico* e `código`.",
    "",
    "## Lista",
    "",
    "- um",
    "- dois",
    "",
    "| k | v |",
    "|---|---|",
    "| a | 1 |",
    "",
    "```js",
    "console.log(1)",
    "```",
    "",
    "> citação",
  ].join("\n");
  assert.deepEqual(parseMarkdown(doc).map((b) => b.t), ["heading", "para", "heading", "list", "table", "code", "quote"]);
});

// ---------- entradas hostis: precisam terminar rápido e sem estourar a pilha ----------

function timed(fn: () => void, maxMs: number, label: string): void {
  const t0 = performance.now();
  fn();
  const ms = performance.now() - t0;
  assert.ok(ms < maxMs, `${label} levou ${ms.toFixed(0)} ms (limite ${maxMs} ms)`);
}

test("citações aninhadas em 5.000 níveis não estouram a pilha", () => {
  timed(() => assert.ok(parseMarkdown(">".repeat(5000) + " fundo").length >= 1), 1000, "aninhamento de citações");
});

test("listas aninhadas em 2.000 níveis não estouram a pilha", () => {
  const source = Array.from({ length: 2000 }, (_, i) => " ".repeat(i * 2) + "- item").join("\n");
  timed(() => assert.ok(parseMarkdown(source).length >= 1), 2000, "aninhamento de listas");
});

test("ênfase aninhada em profundidade não estoura a pilha", () => {
  timed(() => assert.ok(parseMarkdown("*".repeat(3000) + "x" + "*".repeat(3000)).length === 1), 1000, "asteriscos");
  timed(() => assert.ok(parseMarkdown("[".repeat(5000) + "x" + "]".repeat(5000)).length === 1), 1000, "colchetes");
  timed(() => assert.ok(parseMarkdown("(".repeat(5000)).length === 1), 1000, "parênteses");
});

test("milhares de delimitadores sem fecho terminam rápido (sem custo quadrático)", () => {
  timed(() => parseMarkdown("*a ".repeat(3000)), 1500, "asteriscos abertos");
  timed(() => parseMarkdown("`a ".repeat(3000)), 1500, "crases abertas");
  timed(() => parseMarkdown("[a](".repeat(2000)), 1500, "links abertos");
  timed(() => parseMarkdown("~~a ".repeat(2500)), 1500, "tachados abertos");
});

test("muitos parágrafos hostis em um arquivo grande respeitam o orçamento de trabalho", () => {
  const hostile = ("*a ".repeat(3000) + "\n\n").repeat(200); // ~1,8 MB de texto
  timed(() => parseMarkdown(hostile), 4000, "200 parágrafos hostis");
});

test("uma linha enorme e milhares de espaços terminam rápido", () => {
  timed(() => parseMarkdown("a".repeat(2_000_000)), 1500, "linha de 2 MB");
  timed(() => parseMarkdown("a" + " ".repeat(200_000) + "\nb"), 1500, "espaços no fim da linha");
  timed(() => parseMarkdown("[x](" + " ".repeat(100_000) + "\"t\")"), 1500, "espaços no destino do link");
});

test("muitas linhas de tabela e de lista terminam rápido", () => {
  const table = "| a | b |\n|---|---|\n" + "| 1 | 2 |\n".repeat(50_000);
  timed(() => assert.equal(parseMarkdown(table)[0]?.t, "table"), 3000, "tabela de 50 mil linhas");
  const list = "- item\n".repeat(50_000);
  timed(() => assert.equal(parseMarkdown(list)[0]?.t, "list"), 3000, "lista de 50 mil itens");
});
