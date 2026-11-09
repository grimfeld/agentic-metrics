// The report: one static HTML page from the datasets. Per repo, four headline
// cards and each metric's own section; then Methodology, which defines every
// metric present, gives its coverage per repo and links the raw datasets.
import type { Dataset } from "./dataset.ts";
import { datasetPath } from "./dataset.ts";
import { METRICS, findMetric } from "./metrics/index.ts";
import type { MetricResult } from "./metrics/metric.ts";
import { UNKNOWN } from "./metrics/metric.ts";

/** The headline cards, in order. A metric not computed yet shows as unknown under this name. */
const HEADLINES = [
  { id: "leadTime", name: "Lead time" },
  { id: "firstRunCiRate", name: "First-run CI rate" },
  { id: "humanMessagesPerTicket", name: "Human messages per ticket" },
  { id: "regressionRate", name: "Regression rate" },
] as const;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
}

function coverageText(result: MetricResult<unknown>): string {
  return `${String(result.coverage.tickets)} of ${String(result.coverage.of)} tickets`;
}

function card(dataset: Dataset, id: string, fallbackName: string): string {
  const metric = findMetric(id);
  const result = dataset.metrics[id];
  const name = escapeHtml(metric?.name ?? fallbackName);
  if (!metric || !result) {
    return `<article class="card" data-metric="${id}"><h3>${name}</h3><p class="value unknown">unknown</p><p class="coverage">not measured yet</p></article>`;
  }
  const value = result.value === UNKNOWN || !metric.headline ? UNKNOWN : metric.headline(result.value);
  const unknownClass = value === UNKNOWN ? " unknown" : "";
  return `<article class="card" data-metric="${id}"><h3>${name}</h3><p class="value${unknownClass}">${value}</p><p class="coverage">${coverageText(result)}</p></article>`;
}

function repoSection(dataset: Dataset): string {
  const repo = escapeHtml(dataset.repo);
  const cards = HEADLINES.map(({ id, name }) => card(dataset, id, name)).join("\n");
  const sections = METRICS.flatMap((metric) => {
    const result = dataset.metrics[metric.id];
    if (!metric.section || !result) return [];
    const body = result.value === UNKNOWN ? `<p class="unknown">unknown</p>` : metric.section(result.value);
    return [`<section class="metric" data-section="${metric.id}"><h3>${escapeHtml(metric.name)}</h3>${body}</section>`];
  }).join("\n");
  const raw = `datasets/${escapeHtml(datasetPath(dataset.repo))}`;
  return `<section class="repo" id="${repo}" data-repo="${repo}">
<h2>${repo}</h2>
<p class="meta">${String(dataset.tickets)} tickets, ${String(dataset.pullRequests)} PRs merged · collected ${escapeHtml(dataset.generatedAt.slice(0, 10))} · <a href="${raw}">raw dataset</a></p>
<div class="cards">
${cards}
</div>
${sections}
</section><!-- /repo -->`;
}

function methodology(datasets: Dataset[]): string {
  const entries = METRICS.flatMap((metric) => {
    const coverage = datasets.flatMap((dataset) => {
      const result = dataset.metrics[metric.id];
      return result ? [`${escapeHtml(dataset.repo)} ${coverageText(result)}`] : [];
    });
    if (coverage.length === 0) return [];
    return [`<article data-methodology="${metric.id}"><h3>${escapeHtml(metric.name)}</h3>
<p>${metric.methodology.definition}</p>
<p><strong>Limits:</strong> ${metric.methodology.limits}</p>
<p><strong>Coverage:</strong> ${coverage.join("; ")}</p></article>`];
  }).join("\n");
  const links = datasets
    .map((dataset) => `<li><a href="datasets/${escapeHtml(datasetPath(dataset.repo))}">${escapeHtml(dataset.repo)}</a></li>`)
    .join("");
  return `<section id="methodology">
<h2>Methodology</h2>
<p>Every number is derived from GitHub data. A metric whose source is missing is shown as <em>unknown</em>, never as zero. Coverage is the number of tickets a metric is computed over, out of the tickets delivered.</p>
${entries}
<h3>Raw data</h3>
<ul class="datasets">${links}</ul>
</section>`;
}

const STYLE = `
:root { color-scheme: light dark; --fg: #1d1d1f; --muted: #6b6b70; --bg: #fff; --card: #f4f4f6; --line: #dcdce0; }
@media (prefers-color-scheme: dark) { :root { --fg: #ececf0; --muted: #a0a0a8; --bg: #141416; --card: #222226; --line: #38383e; } }
body { margin: 0 auto; max-width: 960px; padding: 24px 16px; font: 16px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.card { background: var(--card); border-radius: 8px; padding: 12px 16px; }
.card h3 { margin: 0; font-size: 14px; font-weight: 500; color: var(--muted); }
.card .value { margin: 4px 0; font-size: 24px; font-weight: 600; }
.card small { font-size: 13px; font-weight: 400; color: var(--muted); }
.unknown { color: var(--muted); font-style: italic; }
.coverage, .meta { margin: 0; font-size: 13px; color: var(--muted); }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { padding: 2px 12px 2px 0; text-align: left; border-bottom: 1px solid var(--line); }
a { color: inherit; }
`;

export function renderReport(datasets: Dataset[]): string {
  const sorted = [...datasets].sort((a, b) => a.repo.localeCompare(b.repo));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agentic metrics</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Agentic metrics</h1>
<nav id="repos">${sorted.map((dataset) => `<a href="#${escapeHtml(dataset.repo)}">${escapeHtml(dataset.repo)}</a>`).join(" ")}</nav>
${sorted.map(repoSection).join("\n")}
${methodology(sorted)}
</body>
</html>
`;
}
