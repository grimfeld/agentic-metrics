// The report's reader-facing summaries of a repo, all built from the dataset
// and each metric's `figure` and `sentence`, so a new metric appears in them
// by declaring those: trends over time, the comparison by autonomy level, and
// CV-ready sentences. A sentence only ever quotes a known value, with its
// coverage.
import { AUTONOMY_LEVELS, type AutonomyLevel } from "./autonomy.ts";
import type { Dataset } from "./dataset.ts";
import { escapeHtml } from "./metrics/html.ts";
import { METRICS } from "./metrics/index.ts";
import type { Coverage, Figure, FigureResult, Metric } from "./metrics/metric.ts";
import { UNKNOWN } from "./metrics/metric.ts";

const LEVEL_NAMES: Record<AutonomyLevel, string> = { full: "Full", assisted: "Assisted", manual: "Manual" };

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? "" : "s"}`;
const coverageOf = ({ tickets, of }: Coverage) => `${String(tickets)} of ${String(of)} tickets`;

/** `2026-10` as `October 2026`. */
function monthName(period: string): string {
  return new Date(`${period}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The metrics this version defines with a figure, in report order, each with the figures `figures` holds for it. */
function withFigures<T>(figures: Record<string, T> | undefined): { metric: Metric<unknown>; figure: Figure<unknown>; results: T }[] {
  if (!figures) return [];
  return METRICS.flatMap((metric) => {
    const results = figures[metric.id];
    return metric.figure && results ? [{ metric, figure: metric.figure, results }] : [];
  });
}

function rowHeader(metric: Metric<unknown>, figure: Figure<unknown>): string {
  return `<th>${escapeHtml(metric.name)} <small>${escapeHtml(figure.label)}</small></th>`;
}

function cell(figure: Figure<unknown>, result: FigureResult): string {
  const value = result.value === UNKNOWN ? `<span class="unknown">unknown</span>` : escapeHtml(figure.format(result.value));
  return `<td>${value} <small>${String(result.coverage.tickets)} of ${String(result.coverage.of)}</small></td>`;
}

export function trendSection(dataset: Dataset): string {
  const trends = dataset.trends;
  const rows = withFigures(trends?.metrics);
  if (!trends || rows.length === 0 || trends.periods.length === 0) return "";
  const head = trends.periods.map(({ period, tickets }) => `<th>${escapeHtml(period)} <small>${plural(tickets, "ticket")}</small></th>`).join("");
  const body = rows
    .map(({ metric, figure, results }) => `<tr data-trend="${metric.id}">${rowHeader(metric, figure)}${results.map((result) => cell(figure, result)).join("")}</tr>`)
    .join("\n");
  return `<section class="trends" data-section="trends"><h3>Trends</h3>
<p>Each metric over the tickets delivered in each month (UTC), with its coverage within the month. Months with no delivery are left out.</p>
<div class="scroll"><table><thead><tr data-trend="periods"><th>Metric</th>${head}</tr></thead><tbody>
${body}
</tbody></table></div></section>`;
}

export function autonomySection(dataset: Dataset): string {
  const rows = withFigures(dataset.byAutonomy);
  if (rows.length === 0) return "";
  // Every metric covers the same tickets per level: the level's tickets are each result's `of`.
  const first = rows[0]?.results;
  const head = AUTONOMY_LEVELS.map((level) => `<th>${LEVEL_NAMES[level]} <small>${plural(first?.[level].coverage.of ?? 0, "ticket")}</small></th>`).join("");
  const body = rows
    .map(({ metric, figure, results }) => `<tr data-autonomy="${metric.id}">${rowHeader(metric, figure)}${AUTONOMY_LEVELS.map((level) => cell(figure, results[level])).join("")}</tr>`)
    .join("\n");
  return `<section class="by-autonomy" data-section="by-autonomy"><h3>By autonomy level</h3>
<p>Each metric over the tickets at each autonomy level (see Autonomy level in Methodology), with its coverage within the level. Metrics no ticket owns, like orchestration time, are left out.</p>
<div class="scroll"><table><thead><tr data-autonomy="levels"><th>Metric</th>${head}</tr></thead><tbody>
${body}
</tbody></table></div></section>`;
}

/** Every CV sentence of a dataset, keyed by what it quotes: `<metric>`, `<metric>:autonomy` or `<metric>:trend`. */
export function cvSentences(dataset: Dataset): { key: string; text: string }[] {
  const sentences: { key: string; text: string }[] = [];
  for (const metric of METRICS) {
    const result = dataset.metrics[metric.id];
    if (!metric.sentence || !result || result.value === UNKNOWN) continue;
    const text = metric.sentence(result.value);
    if (text !== undefined) sentences.push({ key: metric.id, text: `${text}, over ${coverageOf(result.coverage)}.` });
  }

  for (const { metric, figure, results } of withFigures(dataset.byAutonomy)) {
    const full = results.full;
    if (full.value === UNKNOWN) continue;
    const others = (["assisted", "manual"] as const).flatMap((level) => {
      const other = results[level];
      return other.value === UNKNOWN ? [] : [`${figure.format(other.value)} on ${level} ones (${coverageOf(other.coverage)})`];
    });
    if (others.length === 0) continue;
    sentences.push({
      key: `${metric.id}:autonomy`,
      text: `${metric.name} (${figure.label}): ${figure.format(full.value)} on fully autonomous tickets (${coverageOf(full.coverage)}), against ${others.join(" and ")}.`,
    });
  }

  const periods = dataset.trends?.periods ?? [];
  for (const { metric, figure, results } of withFigures(dataset.trends?.metrics)) {
    const known = results.flatMap((result, index) => {
      const period = periods[index]?.period;
      return result.value === UNKNOWN || period === undefined ? [] : [{ value: result.value, coverage: result.coverage, period }];
    });
    const from = known[0];
    const to = known.at(-1);
    if (!from || !to || known.length < 2) continue;
    sentences.push({
      key: `${metric.id}:trend`,
      text: `${metric.name} (${figure.label}) went from ${figure.format(from.value)} in ${monthName(from.period)} (${coverageOf(from.coverage)}) to ${figure.format(to.value)} in ${monthName(to.period)} (${coverageOf(to.coverage)}).`,
    });
  }
  return sentences;
}

export function sentenceSection(dataset: Dataset): string {
  const sentences = cvSentences(dataset);
  if (sentences.length === 0) return "";
  const items = sentences
    .map(({ key, text }) => {
      const escaped = escapeHtml(text);
      return `<li data-sentence="${escapeHtml(key)}"><p class="sentence">${escaped}</p><button type="button" data-copy="${escaped}">Copy</button></li>`;
    })
    .join("\n");
  return `<section class="sentences" data-section="cv-sentences"><h3>CV-ready sentences</h3>
<p>Each quotes exactly what the data says, with its coverage. Unknown metrics are never quoted.</p>
<ul>
${items}
</ul></section>`;
}

/** Copies a sentence on its button's click. Inline: the report loads nothing from the network. */
export const COPY_SCRIPT = `document.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("button[data-copy]") : null;
  if (!button) return;
  navigator.clipboard.writeText(button.getAttribute("data-copy") ?? "").then(() => {
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = "Copy"), 1500);
  });
});`;
