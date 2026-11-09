// The shell every report page shares: colour tokens with a dark-mode
// override (series colours too: blue, orange, aqua, the first three slots of a
// colour-blind-safe categorical order, each stepped for its mode; autonomy
// levels wear them as full, assisted, manual), the sidebar listing every page,
// the title bar, number tiles, and the chart styles. Below phone
// width the sidebar becomes a bar scrolling across the top. Everything is
// inline: the report loads nothing from the network.
import { escapeHtml } from "../metrics/html.ts";
import { COPY_SCRIPT } from "./cv-sentences.ts";
import { CHART_CSS, CHART_SCRIPT } from "./charts.ts";
import { SORT_SCRIPT, TABLE_CSS } from "./ticket-table.ts";
import { PATHS, type PageContext, type SiteRepo } from "./site.ts";

const LIGHT = `--plane: #f7f7f5; --surface: #ffffff; --ink: #111110; --ink-2: #4f4e4a; --muted: #77756f;
  --grid: #e3e2dc; --axis: #c3c2b7; --ring: rgba(17,17,16,0.10); --wash: rgba(42,120,214,0.10); --accent: #1c5cab;
  --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a;`;
const DARK = `--plane: #0f0f0e; --surface: #1b1b1a; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #9a988f;
  --grid: #2c2c2a; --axis: #45443f; --ring: rgba(255,255,255,0.10); --wash: rgba(57,135,229,0.16); --accent: #86b6ef;
  --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70;`;

/** Shared by every page; a page kind adds its own rules through `layout`'s `css`. */
const STYLE = `
:root { color-scheme: light; ${LIGHT} --font: system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { color-scheme: dark; ${DARK} }
}
:root[data-theme="dark"] { color-scheme: dark; ${DARK} }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--plane); color: var(--ink); font: 15px/1.5 var(--font); }
a { color: inherit; text-underline-offset: 3px; text-decoration-color: var(--axis); }
a:hover { text-decoration-color: currentColor; }
code { font-size: .9em; }
.shell { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 100vh; }
nav.side { position: sticky; top: 0; height: 100vh; overflow-y: auto; background: var(--surface); border-right: 1px solid var(--grid); padding: 16px 10px 48px; font-size: 13px; }
nav.side a { display: flex; justify-content: space-between; gap: 8px; padding: 4px 8px; border-radius: 6px; text-decoration: none; color: var(--ink-2); }
nav.side a:hover { background: var(--plane); color: var(--ink); }
nav.side a[aria-current="page"] { background: var(--wash); color: var(--ink); font-weight: 600; }
nav.side .brand { font-weight: 700; font-size: 14px; color: var(--ink); padding-bottom: 12px; }
nav.side .v { color: var(--muted); font-variant-numeric: tabular-nums; font-weight: 400; }
nav.side .grp { color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-size: 11px; font-weight: 600; padding: 14px 8px 4px; }
nav.side details { margin: 0 0 4px; }
nav.side summary { cursor: pointer; color: var(--muted); font-size: 12px; padding: 2px 8px 2px 18px; }
nav.side .sub a { padding-left: 18px; }
nav.side .sub .grp { padding: 8px 8px 2px 18px; text-transform: none; letter-spacing: 0; }
main { padding: 20px 28px 48px; min-width: 0; max-width: 1200px; }
.bar { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 16px; margin-bottom: 16px; }
.bar h1 { font-size: 22px; margin: 0; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font-size: 12px; color: var(--ink-2); background: var(--surface); border: 1px solid var(--ring); border-radius: 999px; padding: 2px 10px; text-decoration: none; }
.card { background: var(--surface); border: 1px solid var(--ring); border-radius: 10px; padding: 14px 16px; margin: 0 0 12px; min-width: 0; }
.card > h2, .card > h3 { font-size: 15px; margin: 0 0 8px; }
.muted, .coverage, .meta { color: var(--muted); }
.coverage, .meta { margin: 0; font-size: 13px; }
.unknown { color: var(--muted); font-style: italic; font-weight: 400; }
small { font-size: 12px; font-weight: 400; color: var(--muted); }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; font-size: 14px; }
th, td { padding: 6px 12px 6px 0; text-align: left; vertical-align: top; border-bottom: 1px solid var(--grid); }
th { font-weight: 500; color: var(--ink-2); font-size: 13px; }
.scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.card > table, .card section > table { display: block; max-width: 100%; overflow-x: auto; }
main p, main li { overflow-wrap: anywhere; }
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; margin-bottom: 12px; }
.tile { display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--ring); border-radius: 10px; padding: 10px 12px; min-width: 0; text-decoration: none; }
a.tile:hover { border-color: var(--axis); }
.tile h2, .tile h3 { margin: 0; font-size: 12px; font-weight: 500; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile .value { margin: 2px 0; font-size: 20px; font-weight: 650; line-height: 1.25; font-variant-numeric: tabular-nums; }
.tile.lg .value { font-size: 24px; }
.tile .foot { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-top: auto; }
.tile .coverage { font-size: 12px; }
.sentences ul { list-style: none; margin: 0; padding: 0; }
.sentences li { display: flex; gap: 12px; align-items: flex-start; padding: 6px 0; border-top: 1px solid var(--grid); }
.sentences li:first-child { border-top: 0; }
.sentence { margin: 0; flex: 1; user-select: all; }
.sentences button { font: inherit; font-size: 12px; padding: 2px 10px; border: 1px solid var(--ring); border-radius: 6px; background: var(--plane); color: var(--ink); cursor: pointer; }
@media (max-width: 760px) {
  nav.side { position: static; height: auto; display: flex; overflow-x: auto; gap: 4px; padding: 8px; border-right: 0; border-bottom: 1px solid var(--grid); white-space: nowrap; }
  .shell { grid-template-columns: minmax(0, 1fr); }
  nav.side .grp, nav.side details { display: none; }
  nav.side .brand { padding: 4px 8px; }
  main { padding: 16px; }
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
${CHART_CSS}${TABLE_CSS}`;

function navLink(ctx: PageContext, to: string, label: string, value = ""): string {
  const current = to === ctx.path ? ' aria-current="page"' : "";
  return `<a href="${escapeHtml(ctx.link(to))}"${current}>${label}${value ? `<span class="v">${value}</span>` : ""}</a>`;
}

/** A repo, then its metrics and case studies, folded unless the reader is on one of its pages. */
function repoNav(ctx: PageContext, repo: SiteRepo): string {
  const open = ctx.path.startsWith(`${repo.dir}/`) || ctx.site.repos.length === 1;
  const metrics = repo.metrics.map((metric) => navLink(ctx, PATHS.metric(repo, metric), escapeHtml(metric.name))).join("");
  const studies = repo.studies.length
    ? `<div class="grp">Case studies</div>${repo.studies.map((s) => navLink(ctx, PATHS.caseStudy(repo, s), escapeHtml(s.study.ticket))).join("")}`
    : "";
  const what = repo.studies.length ? "Metrics and case studies" : "Metrics";
  return `${navLink(ctx, PATHS.repo(repo), escapeHtml(repo.dataset.repo), String(repo.dataset.tickets))}
<details class="sub"${open ? " open" : ""}><summary>${what}</summary>${metrics}${studies}</details>`;
}

function sidebar(ctx: PageContext): string {
  const repos = ctx.site.repos.map((repo) => repoNav(ctx, repo)).join("\n");
  return `<nav class="side" aria-label="Report pages">
<a class="brand" href="${escapeHtml(ctx.link(PATHS.overview))}">Agentic metrics</a>
${navLink(ctx, PATHS.overview, "Overview")}
${repos ? `<div class="grp">Repos</div>\n${repos}` : ""}
<div class="grp">Reference</div>
${navLink(ctx, PATHS.methodology, "Methodology")}
</nav>`;
}

export interface PageParts {
  /** Plain text: the `<title>`. */
  title: string;
  /** HTML: the page's heading; the title when absent. */
  heading?: string;
  /** HTML: small facts beside the heading. */
  chips?: string;
  /** HTML. */
  body: string;
  /** Extra CSS for this kind of page. */
  css?: string;
}

/** One complete page in the shell. */
export function layout(ctx: PageContext, parts: PageParts): string {
  const title = parts.title === "Agentic metrics" ? parts.title : `${parts.title} · Agentic metrics`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}${parts.css ?? ""}</style>
</head>
<body>
<div class="shell">
${sidebar(ctx)}
<main>
<div class="bar"><h1>${parts.heading ?? escapeHtml(parts.title)}</h1>${parts.chips ? `<div class="chips">${parts.chips}</div>` : ""}</div>
${parts.body}
</main>
</div>
<script>${COPY_SCRIPT}
${CHART_SCRIPT}
${SORT_SCRIPT}</script>
</body>
</html>
`;
}

/** A chip: a small fact beside a page's heading; a link when `href` is given (already relative). */
export function chip(html: string, href?: string): string {
  return href ? `<a class="chip" href="${escapeHtml(href)}">${html}</a>` : `<span class="chip">${html}</span>`;
}
