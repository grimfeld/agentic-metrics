// A metric's page within a repo: `<repo>/<metric-id>.html`. Number tiles (its
// figure, how many months are known, its figure per autonomy level); a grid
// of cards: its own chart, its figure by month and by autonomy level and its
// summary; then its per-ticket table (sortable, and never on an anonymized
// repo's page), its monthly trend as a table, and its definition. Every metric
// gets one: a metric without a chart, a figure or a table shows the rest.
import { AUTONOMY_LEVELS, type AutonomyLevel } from "../autonomy.ts";
import { escapeHtml } from "../metrics/html.ts";
import type { Figure, FigureResult, Metric } from "../metrics/metric.ts";
import { SUPPRESSED, UNKNOWN } from "../metrics/metric.ts";
import { coverageText } from "../metrics/stats.ts";
import { MIN_ANONYMIZED_TICKETS } from "../trends.ts";
import { autonomyComparison, drawnValue, monthLabel, renderChart, sparkline, trendLine } from "./charts.ts";
import { tileValue } from "./headline.ts";
import { chartInput, metricChart } from "./metric-chart.ts";
import { DASHBOARD_CSS } from "./repo-page.ts";
import { chip, layout } from "./shell.ts";
import { PATHS, type PageContext, type SiteRepo } from "./site.ts";
import { ticketTable } from "./ticket-table.ts";

const LEVEL_NAMES: Record<AutonomyLevel, string> = { full: "Full", assisted: "Assisted", manual: "Manual" };

/** A figure over a subset of tickets, as text: `unknown` and withheld ones say so. HTML. */
function figureValue(figure: Figure<unknown>, result: FigureResult): string {
  if (result.value === UNKNOWN) return `<span class="unknown">unknown</span>`;
  if (result.value === SUPPRESSED) return `<span class="unknown" title="Withheld: fewer than ${String(MIN_ANONYMIZED_TICKETS)} tickets">—</span>`;
  return escapeHtml(figure.format(result.value));
}

function tile(key: string, name: string, value: string, foot: string, lg = false): string {
  const unknown = value.includes('class="unknown"') ? " unknown" : "";
  return `<div class="tile${lg ? " lg" : ""}" data-tile="${key}"><h3>${escapeHtml(name)}</h3><p class="value${unknown}">${value}</p><div class="foot">${foot}</div></div>`;
}

function tiles(repo: SiteRepo, metric: Metric<unknown>): string {
  const { dataset } = repo;
  const result = dataset.metrics[metric.id];
  const trend = dataset.trends?.metrics[metric.id] ?? [];
  const coverage = `<p class="coverage">${result ? coverageText(result.coverage) : "not measured yet"}</p>`;
  const items = [tile("value", metric.name, tileValue(metric, dataset), `${coverage}${sparkline(trend.map((month) => drawnValue(metric.figure, month.value)))}`, true)];
  const { figure } = metric;
  if (figure && trend.length) {
    const known = trend.filter((month) => typeof month.value === "number").length;
    items.push(tile("months", "Months known", `${String(known)} of ${String(trend.length)}`, `<p class="coverage">unknown months are gaps, not zero</p>`));
  }
  const levels = dataset.byAutonomy?.[metric.id];
  if (figure && figure.byAutonomy !== false && levels) {
    for (const level of AUTONOMY_LEVELS) {
      const at = levels[level];
      items.push(tile(level, LEVEL_NAMES[level], figureValue(figure, at), `<p class="coverage">${coverageText(at.coverage)}</p>`));
    }
  }
  return `<section class="tiles" data-section="tiles" aria-label="${escapeHtml(metric.name)} in numbers">\n${items.join("\n")}\n</section>`;
}

function card(section: string, title: string, body: string, wide = false): string {
  return `<section class="card chart-card${wide ? " wide" : ""}" data-section="${section}"><h2>${escapeHtml(title)}</h2>\n${body}\n</section>`;
}

/** Its own chart, then its figure by month and by autonomy level. */
function charts(repo: SiteRepo, metric: Metric<unknown>): string[] {
  const { dataset } = repo;
  const input = chartInput(dataset, metric);
  const cards: string[] = [];
  const own = metric.chart && input ? metric.chart.draw(input) : undefined;
  if (metric.chart) cards.push(card("chart", metric.chart.title, metricChart(dataset, metric)));
  const { figure } = metric;
  if (!figure) return cards;
  // A chart that is already a line over months (lead time's, anonymized) is the trend.
  if ((dataset.trends?.periods.length ?? 0) > 0 && own?.kind !== "line") {
    const title = `${metric.name} by month`;
    const body = input ? renderChart(trendLine(input, figure, metric.name), { id: `trend-${metric.id}`, title }) : `<p class="unknown">unknown</p>`;
    cards.push(card("by-month", title, body));
  }
  const comparison = input && figure.byAutonomy !== false ? autonomyComparison(input, figure, metric.name) : undefined;
  if (comparison) {
    const title = `${metric.name} by autonomy level`;
    cards.push(card("by-autonomy", title, renderChart(comparison, { id: `autonomy-${metric.id}`, title })));
  }
  return cards;
}

/** The metric's own summary of its value, when it has one. */
function summary(repo: SiteRepo, metric: Metric<unknown>): string {
  const result = repo.dataset.metrics[metric.id];
  if (!metric.section || !result) return "";
  const body = result.value === UNKNOWN ? `<p class="unknown">unknown</p>` : metric.section(result.value);
  return `<section class="card" data-section="${metric.id}"><h2>Summary</h2>${body}</section>`;
}

function definition(repo: SiteRepo, metric: Metric<unknown>): string {
  const result = repo.dataset.metrics[metric.id];
  return `<section class="card wide" data-section="definition"><h2>Definition</h2>
<p>${metric.methodology.definition}</p>
<p><strong>Limits:</strong> ${metric.methodology.limits}</p>
${result ? `<p class="coverage">Computed over ${coverageText(result.coverage)}.</p>` : ""}
</section>`;
}

/** The figure in each month with deliveries, with its coverage. */
function trendTable(repo: SiteRepo, metric: Metric<unknown>): string {
  const { figure } = metric;
  const trends = repo.dataset.trends;
  const results = trends?.metrics[metric.id];
  if (!figure || !trends || !results || trends.periods.length === 0) return "";
  const body = trends.periods
    .flatMap(({ period }, i) => {
      const result = results[i];
      if (!result) return [];
      return [`<tr><td>${escapeHtml(monthLabel(period))}</td><td>${figureValue(figure, result)}</td><td>${String(result.coverage.tickets)} of ${String(result.coverage.of)}</td></tr>`];
    })
    .join("");
  return `<section class="card wide" data-section="trend"><h2>Monthly trend</h2>
<p class="meta">Over the tickets delivered in each month (UTC). Months with no delivery are left out.</p>
<div class="scroll"><table><thead><tr><th>Month</th><th>${escapeHtml(metric.name)} (${escapeHtml(figure.label)})</th><th>Tickets</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
}

export function metricPage(ctx: PageContext, repo: SiteRepo, metric: Metric<unknown>): string {
  const back = ctx.link(PATHS.repo(repo));
  const cards = [...charts(repo, metric), summary(repo, metric)].filter(Boolean);
  const body = `${tiles(repo, metric)}
<div class="chart-grid">
${cards.join("\n")}
${ticketTable(repo, metric)}
${trendTable(repo, metric)}
${definition(repo, metric)}
</div>`;
  return layout(ctx, {
    title: `${metric.name} · ${repo.dataset.repo}`,
    heading: `${escapeHtml(metric.name)} <small>${escapeHtml(repo.dataset.repo)}</small>`,
    chips: [chip(escapeHtml(repo.dataset.repo), back), chip("Methodology", `${ctx.link(PATHS.methodology)}#${metric.id}`)].join(""),
    body,
    css: DASHBOARD_CSS,
  });
}
