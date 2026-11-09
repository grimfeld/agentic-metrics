// A repo's page: `<repo>/index.html`. Number tiles, one per metric (headline
// metrics first), each with a sparkline of its monthly trend and linking to
// the metric's page; a grid of chart cards, one per metric that declares a
// chart; the CV-ready sentences and the case-study cards. Below them, the
// detail tables: trends, the comparison by autonomy level, each metric's own
// section and the delivered tickets (until each moves to its metric page).
// An anonymized repo's dataset holds aggregates only, so its page does too.
import type { Dataset } from "../dataset.ts";
import { escapeHtml } from "../metrics/html.ts";
import type { Metric } from "../metrics/metric.ts";
import { UNKNOWN } from "../metrics/metric.ts";
import { METRICS } from "../metrics/index.ts";
import { coverageText } from "../metrics/stats.ts";
import { autonomySection, sentenceSection, trendSection } from "../report-trends.ts";
import { sparkline } from "./charts.ts";
import { HEADLINES, headlineValue } from "./headline.ts";
import { metricChart } from "./metric-chart.ts";
import { chip, layout } from "./shell.ts";
import { PATHS, type PageContext, type SiteRepo, type SiteStudy } from "./site.ts";

const CSS = `
.tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; margin-bottom: 12px; }
.tile { display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--ring); border-radius: 10px; padding: 10px 12px; min-width: 0; text-decoration: none; }
a.tile:hover { border-color: var(--axis); }
.tile h3 { margin: 0; font-size: 12px; font-weight: 500; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile .value { margin: 2px 0; font-size: 20px; font-weight: 650; line-height: 1.25; font-variant-numeric: tabular-nums; }
.tile.lg .value { font-size: 24px; }
.tile .foot { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-top: auto; }
.tile .coverage { font-size: 12px; }
.chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
.chart-grid > .card { margin: 0; }
.chart-grid > .wide { grid-column: 1 / -1; }
.chart-card h2 { font-size: 14px; margin: 0 0 8px; }
.chart-card h2 a { text-decoration: none; }
.chart-card h2 a:hover { text-decoration: underline; }
.chart-card > .coverage { margin-top: 4px; }
.studies { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
.study-card { display: block; text-decoration: none; background: var(--plane); border-radius: 8px; padding: 8px 10px; font-size: 13px; }
.study-card:hover { background: var(--wash); }
.study-card b { display: block; font-weight: 600; margin-bottom: 2px; }
.detail-heading { font-size: 16px; margin: 24px 0 8px; }
.tickets ul { padding-left: 20px; }
@media (max-width: 760px) {
  .chart-grid { grid-template-columns: minmax(0, 1fr); }
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
`;

/** The metric's figure on a tile: its headline card when it has one, else its trend figure. HTML. */
function tileValue(metric: Metric<unknown>, dataset: Dataset): string {
  const result = dataset.metrics[metric.id];
  if (metric.headline || !result || result.value === UNKNOWN || !metric.figure) return headlineValue(metric, result);
  const figure = metric.figure.of(result.value);
  if (!Number.isFinite(figure)) return headlineValue(metric, undefined);
  return `${escapeHtml(metric.figure.format(figure))} <small>${escapeHtml(metric.figure.label)}</small>`;
}

function tile(ctx: PageContext, repo: SiteRepo, metric: Metric<unknown>): string {
  const { dataset } = repo;
  const result = dataset.metrics[metric.id];
  const value = tileValue(metric, dataset);
  const unknown = value.includes('class="unknown"') ? " unknown" : "";
  const coverage = result ? coverageText(result.coverage) : "not measured yet";
  const trend = (dataset.trends?.metrics[metric.id] ?? []).map((figure) => figure.value);
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

/** A case study's title: its first heading, else its ticket. */
function studyTitle({ study }: SiteStudy): string {
  return /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(study.markdown)?.[1] ?? `Case study ${study.ticket}`;
}

function studyCards(ctx: PageContext, repo: SiteRepo): string {
  if (repo.studies.length === 0) return "";
  const cards = repo.studies
    .map(
      (s) =>
        `<a class="study-card" href="${escapeHtml(ctx.link(PATHS.caseStudy(repo, s)))}"><b>${escapeHtml(studyTitle(s))}</b><span class="muted">Case study ${escapeHtml(s.study.ticket)}</span></a>`,
    )
    .join("");
  return `<section class="card wide" data-section="case-studies"><h2>Case studies</h2><div class="studies">${cards}</div></section>`;
}

function metricSections(ctx: PageContext, repo: SiteRepo): string {
  return repo.metrics
    .flatMap((metric) => {
      const result = repo.dataset.metrics[metric.id];
      if (!metric.section || !result) return [];
      const body = result.value === UNKNOWN ? `<p class="unknown">unknown</p>` : metric.section(result.value);
      const heading = `<a href="${escapeHtml(ctx.link(PATHS.metric(repo, metric)))}">${escapeHtml(metric.name)}</a>`;
      return [`<section class="metric card" data-section="${metric.id}"><h3>${heading}</h3>${body}</section>`];
    })
    .join("\n");
}

/** The delivered tickets with their titles and links, latest first; only a `full` dataset has them. */
function ticketList(repo: SiteRepo): string {
  const tickets = repo.dataset.ticketList;
  if (!tickets?.length) return "";
  const items = [...tickets]
    .reverse()
    .map((ticket) => {
      const label = `${escapeHtml(ticket.id)} ${escapeHtml(ticket.title)}`;
      const linked = ticket.url ? `<a href="${escapeHtml(ticket.url)}">${label}</a>` : label;
      return `<li>${linked} <small>${escapeHtml(ticket.doneAt.slice(0, 10))}</small></li>`;
    })
    .join("");
  return `<details class="tickets card" data-section="tickets"><summary>Tickets delivered (${String(tickets.length)})</summary><ul>${items}</ul></details>`;
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
  ].join("");
  const sentences = sentenceSection(dataset).replace(/^<section class="([^"]*)"/, '<section class="$1 card wide"');
  const studies = studyCards(ctx, repo);
  const body = `<section class="repo" id="${name}" data-repo="${name}">
${tiles(ctx, repo)}
${charts(ctx, repo)}
${sentences || studies ? `<div class="chart-grid">\n${sentences}\n${studies}\n</div>` : ""}
<h2 class="detail-heading">Detail</h2>
${wrap(trendSection(dataset))}
${wrap(autonomySection(dataset))}
${metricSections(ctx, repo)}
${ticketList(repo)}
</section><!-- /repo -->`;
  return layout(ctx, { title: dataset.repo, chips, body, css: CSS });
}

/** A summary section as a card. */
function wrap(section: string): string {
  return section.replace(/^<section class="([^"]*)"/, '<section class="$1 card"');
}
