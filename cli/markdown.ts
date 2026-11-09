// The little Markdown a case study needs, as HTML: headings (`#` renders as
// <h4>, under the report's repo and section headings), `-`/`*` lists, `>`
// quotes and paragraphs; inline `code` and [links](https://…). Everything else
// is text: all input is escaped first, so no raw HTML gets through.
import { escapeHtml } from "./metrics/html.ts";

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

type Block = { kind: "p" | "ul" | "blockquote"; lines: string[] };

export function renderMarkdown(markdown: string): string {
  const html: string[] = [];
  let block: Block | undefined;
  const flush = () => {
    if (!block) return;
    if (block.kind === "ul") html.push(`<ul>${block.lines.map((line) => `<li>${inline(line)}</li>`).join("")}</ul>`);
    else html.push(`<${block.kind}>${block.lines.map(inline).join("<br>")}</${block.kind}>`);
    block = undefined;
  };
  const add = (kind: Block["kind"], line: string) => {
    if (block?.kind !== kind) flush();
    block ??= { kind, lines: [] };
    block.lines.push(line);
  };
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (line.trim() === "") flush();
    else if (heading) {
      flush();
      const level = Math.min(3 + (heading[1]?.length ?? 1), 6);
      html.push(`<h${String(level)}>${inline(heading[2] ?? "")}</h${String(level)}>`);
    } else if (item) add("ul", item[1] ?? "");
    else if (quote) add("blockquote", quote[1] ?? "");
    else add("p", line);
  }
  flush();
  return html.join("\n");
}
