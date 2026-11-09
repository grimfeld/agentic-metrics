// The little Markdown a case study needs, as HTML: headings (`#` renders as
// <h4>, under the report's repo and section headings), `-`/`*` lists (an
// indented line continues the item above it, on a line of its own), `>` quotes, fenced code blocks (```diff renders as <pre><code
// class="language-diff">) and paragraphs; inline `code`, **bold**, *emphasis*
// and [links](https://…). Everything else is text: all input is escaped first, so
// no raw HTML gets through.
import { escapeHtml } from "./metrics/html.ts";

/** `**strong**` and `*em*` around text that neither starts nor ends with a space. */
function emphasis(html: string): string {
  return html.replace(/\*\*(\S(?:[^*]*?\S)?)\*\*/g, "<strong>$1</strong>").replace(/\*(\S(?:[^*]*?\S)?)\*/g, "<em>$1</em>");
}

function inline(text: string): string {
  // Code spans are left as they are: no emphasis or link inside them.
  return escapeHtml(text)
    .split(/(`[^`]+`)/)
    .map((part, i) => (i % 2 === 1 ? `<code>${part.slice(1, -1)}</code>` : emphasis(part)))
    .join("")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

/** A list's lines are its items, each with its continuation lines joined by `\n`. */
type Block = { kind: "p" | "ul" | "blockquote"; lines: string[] };

/** An opening fence: three or more backticks, then an optional language. */
const FENCE = /^ {0,3}(`{3,})\s*([\w+#.-]*)[^`]*$/;

export function renderMarkdown(markdown: string): string {
  const html: string[] = [];
  let block: Block | undefined;
  let code: { fence: string; language: string; lines: string[] } | undefined;
  const flush = () => {
    if (!block) return;
    if (block.kind === "ul") html.push(`<ul>${block.lines.map((item) => `<li>${item.split("\n").map(inline).join("<br>")}</li>`).join("")}</ul>`);
    else html.push(`<${block.kind}>${block.lines.map(inline).join("<br>")}</${block.kind}>`);
    block = undefined;
  };
  const add = (kind: Block["kind"], line: string) => {
    if (block?.kind !== kind) flush();
    block ??= { kind, lines: [] };
    block.lines.push(line);
  };
  const closeCode = () => {
    if (!code) return;
    const language = code.language ? ` class="language-${escapeHtml(code.language)}"` : "";
    html.push(`<pre><code${language}>${escapeHtml(code.lines.join("\n"))}</code></pre>`);
    code = undefined;
  };
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (code) {
      // A closing fence is at least as long as the opening one, with nothing after it.
      if (new RegExp(`^ {0,3}${code.fence}\`*\\s*$`).test(raw)) closeCode();
      else code.lines.push(raw);
      continue;
    }
    const line = raw.trimEnd();
    const fence = FENCE.exec(line);
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (fence) {
      flush();
      code = { fence: fence[1] ?? "```", language: fence[2] ?? "", lines: [] };
    } else if (line.trim() === "") flush();
    else if (heading) {
      flush();
      const level = Math.min(3 + (heading[1]?.length ?? 1), 6);
      html.push(`<h${String(level)}>${inline(heading[2] ?? "")}</h${String(level)}>`);
    } else if (item) add("ul", item[1] ?? "");
    else if (block?.kind === "ul" && /^\s/.test(line)) block.lines.push(`${block.lines.pop() ?? ""}\n${line.trim()}`);
    else if (quote) add("blockquote", quote[1] ?? "");
    else add("p", line);
  }
  // An unclosed fence runs to the end of the story, without its trailing blank lines.
  if (code) while (code.lines.at(-1)?.trim() === "") code.lines.pop();
  closeCode();
  flush();
  return html.join("\n");
}
