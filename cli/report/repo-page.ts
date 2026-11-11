// A repo's page: `<repo>/index.html`. Number tiles, one per metric (headline
// metrics first), each with a sparkline of its monthly trend and linking to
// the metric's page; a grid of chart cards, one per metric that declares a
// chart; the CV-ready sentences and the case-study cards. Each metric's
// detail (its summary, monthly trend, comparison by autonomy level and
// per-ticket table) is on its own page.
// An anonymized repo's dataset holds aggregates only, so its page does too.
import { escapeHtml } from "../metrics/html.ts";
import type { Metric } from "../metrics/metric.ts";
import { METRICS } from "../metrics/index.ts";
import { coverageText } from "../metrics/stats.ts";
import { sentenceSection } from "./cv-sentences.ts";
import { drawnValue, sparkline } from "./charts.ts";
import { HEADLINES, tileValue } from "./headline.ts";
import { studyTitle } from "./case-study-page.ts";
import { metricChart } from "./metric-chart.ts";
import { chip, layout } from "./shell.ts";
import { PATHS, type PageContext, type SiteRepo } from "./site.ts";

/** A grid of chart cards: the repo page's, and each metric page's. Number tiles are the shell's. */
export const DASHBOARD_CSS = `
.chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
.chart-grid > .card { margin: 0; }
.chart-grid > .wide { grid-column: 1 / -1; }
.chart-card h2 { font-size: 14px; margin: 0 0 8px; }
.chart-card h2 a { text-decoration: none; }
.chart-card h2 a:hover { text-decoration: underline; }
.chart-card > .coverage { margin-top: 4px; }
@media (max-width: 760px) { .chart-grid { grid-template-columns: minmax(0, 1fr); } }
`;

const CSS = `${DASHBOARD_CSS}
.studies { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
.study-card { display: block; text-decoration: none; background: var(--plane); border-radius: 8px; padding: 8px 10px; font-size: 13px; }
.study-card:hover { background: var(--wash); }
.study-card b { display: block; font-weight: 600; margin-bottom: 2px; }
`;

function tile(ctx: PageContext, repo: SiteRepo, metric: Metric<unknown>): string {
  const { dataset } = repo;
  const result = dataset.metrics[metric.id];
  const value = tileValue(metric, dataset);
  const unknown = value.includes('class="unknown"') ? " unknown" : "";
  const coverage = result ? coverageText(result.coverage) : "not measured yet";
  const trend = (dataset.trends?.metrics[metric.id] ?? []).map((month) => drawnValue(metric.figure, month.value));
  const size = metric.headline ? " lg" : "";
  const inner = `<h3>${escapeHtml(metric.name)}</h3><p class="value${unknown}">${value}</p><div class="foot"><p class="coverage">${coverage}</p>${sparkline(trend)}</div>`;
  // A metric missing from a dataset written before it existed has no page to link to.
  if (!repo.metrics.includes(metric)) return `<div class="tile${size}" data-metric="${metric.id}">${inner}</div>`;
  return `<a class="tile${size}" href="${escapeHtml(ctx.link(PATHS.metric(repo, metric)))}" data-metric="${metric.id}">${inner}</a>`;
}

/** Headline metrics first, in card order, then the others in report order. */
function tiles(ctx: PageContext, repo: SiteRepo): string {
  const others = repo.metrics.filter((metric) => !metric.headline);
  const items = [...HEADLINES, ...others].map((metric) => tile(ctx, repo, metric)).join("\n");
  return `<section class="tiles" data-section="tiles" aria-label="Each metric's figure">\n${items}\n</section>`;
}

function chartCard(ctx: PageContext, repo: SiteRepo, metric: Metric<unknown>): string {
  const result = repo.dataset.metrics[metric.id];
  const title = `<a href="${escapeHtml(ctx.link(PATHS.metric(repo, metric)))}">${escapeHtml(metric.chart?.title ?? metric.name)}</a>`;
  const coverage = `<p class="coverage">${result ? coverageText(result.coverage) : "not measured yet"}</p>`;
  return `<section class="card chart-card" data-chart="${metric.id}"><h2>${title}</h2>\n${metricChart(repo.dataset, metric)}\n${coverage}</section>`;
}

/** A card per metric that declares a chart, in report order. */
function charts(ctx: PageContext, repo: SiteRepo): string {
  const charted = METRICS.filter((metric) => metric.chart && repo.metrics.includes(metric));
  if (charted.length === 0) return "";
  return `<div class="chart-grid" data-section="charts">\n${charted.map((metric) => chartCard(ctx, repo, metric)).join("\n")}\n</div>`;
}

function studyCards(ctx: PageContext, repo: SiteRepo): string {
  if (repo.studies.length === 0) return "";
  const cards = repo.studies
    .map(
      (s) =>
        `<a class="study-card" href="${escapeHtml(ctx.link(PATHS.caseStudy(repo, s)))}"><b>${escapeHtml(studyTitle(s.study).title)}</b><span class="muted">Case study ${escapeHtml(s.study.ticket)}</span></a>`,
    )
    .join("");
  return `<section class="card wide" data-section="case-studies"><h2>Case studies</h2><div class="studies">${cards}</div></section>`;
}

export function repoPage(ctx: PageContext, repo: SiteRepo): string {
  const { dataset } = repo;
  const name = escapeHtml(dataset.repo);
  const chips = [
    chip(`${String(dataset.tickets)} tickets`),
    chip(`${String(dataset.pullRequests)} PRs merged`),
    chip(`collected ${escapeHtml(dataset.generatedAt.slice(0, 10))}`),
    dataset.url ? chip("GitHub", dataset.url) : "",
    chip("raw dataset", ctx.link(PATHS.dataset(repo))),
    chip(`data coverage: ${String(dataset.gaps?.length ?? 0)} gaps`, ctx.link(PATHS.coverage(repo))),
  ].join("");
  const sentences = sentenceSection(dataset).replace(/^<section class="([^"]*)"/, '<section class="$1 card wide"');
  const studies = studyCards(ctx, repo);
  const body = `<section class="repo" id="${name}" data-repo="${name}">
${tiles(ctx, repo)}
${charts(ctx, repo)}
${sentences || studies ? `<div class="chart-grid">\n${sentences}\n${studies}\n</div>` : ""}
</section><!-- /repo -->`;
  return layout(ctx, { title: dataset.repo, chips, body, css: CSS });
}
