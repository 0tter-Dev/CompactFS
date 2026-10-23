import type { Block, Inline } from "./markdown.ts";

/**
 * Desenha a árvore do markdown. Só usa `createElement` e `textContent` (nunca `innerHTML`).
 *
 * Links e imagens do documento nunca são ativados: um link vira um trecho de texto sublinhado, com o
 * endereço no `title`, e uma imagem vira o texto alternativo. Assim um arquivo não consegue levar
 * o app para outro endereço, carregar conteúdo remoto nem ler arquivos locais.
 */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function renderInline(nodes: Inline[], into: Node): void {
  for (const n of nodes) {
    switch (n.t) {
      case "text":
        into.appendChild(document.createTextNode(n.v));
        break;
      case "code": {
        const code = el("code");
        code.textContent = n.v;
        into.appendChild(code);
        break;
      }
      case "strong": {
        const s = el("strong");
        renderInline(n.c, s);
        into.appendChild(s);
        break;
      }
      case "em": {
        const e = el("em");
        renderInline(n.c, e);
        into.appendChild(e);
        break;
      }
      case "del": {
        const d = el("del");
        renderInline(n.c, d);
        into.appendChild(d);
        break;
      }
      case "link": {
        const span = el("span", "md-link");
        span.title = n.href;
        renderInline(n.c, span);
        into.appendChild(span);
        break;
      }
      case "image": {
        const span = el("span", "md-image");
        span.textContent = n.alt === "" ? "[imagem]" : `[imagem: ${n.alt}]`;
        span.title = n.src;
        into.appendChild(span);
        break;
      }
      case "br":
        into.appendChild(el("br"));
        break;
    }
  }
}

function renderBlock(b: Block, into: Node): void {
  switch (b.t) {
    case "heading": {
      const h = el(`h${b.level}` as "h1");
      renderInline(b.c, h);
      into.appendChild(h);
      break;
    }
    case "para": {
      const p = el("p");
      renderInline(b.c, p);
      into.appendChild(p);
      break;
    }
    case "code": {
      const pre = el("pre", "md-code");
      const code = el("code");
      code.textContent = b.v;
      if (b.lang) pre.dataset.lang = b.lang;
      pre.appendChild(code);
      into.appendChild(pre);
      break;
    }
    case "quote": {
      const q = el("blockquote");
      for (const child of b.c) renderBlock(child, q);
      into.appendChild(q);
      break;
    }
    case "list": {
      const list = el(b.ordered ? "ol" : "ul");
      if (b.ordered && b.start !== 1) list.setAttribute("start", String(b.start));
      for (const item of b.items) {
        const li = el("li");
        if (item.task !== null) {
          li.className = "md-task";
          li.appendChild(document.createTextNode(item.task ? "☑ " : "☐ "));
        }
        // Lista "compacta": o único parágrafo do item vira texto direto (sem <p>), como no markdown
        // comum; com mais de um parágrafo, cada um mantém o seu espaçamento.
        const paragraphs = item.c.filter((c) => c.t === "para").length;
        for (const child of item.c) {
          if (child.t === "para" && paragraphs === 1) renderInline(child.c, li);
          else renderBlock(child, li);
        }
        list.appendChild(li);
      }
      into.appendChild(list);
      break;
    }
    case "hr":
      into.appendChild(el("hr"));
      break;
    case "table": {
      const table = el("table");
      const thead = el("thead");
      const headRow = el("tr");
      b.head.forEach((cell, i) => {
        const th = el("th");
        if (b.align[i]) th.style.textAlign = b.align[i] as string;
        renderInline(cell, th);
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      const tbody = el("tbody");
      for (const row of b.rows) {
        const tr = el("tr");
        row.forEach((cell, i) => {
          const td = el("td");
          if (b.align[i]) td.style.textAlign = b.align[i] as string;
          renderInline(cell, td);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      }
      table.append(thead, tbody);
      into.appendChild(table);
      break;
    }
  }
}

export function renderMarkdown(blocks: Block[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const block of blocks) renderBlock(block, fragment);
  return fragment;
}
