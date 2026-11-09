// The report's CV-ready sentences, built from the dataset and each metric's
// `figure` and `sentence`, so a new metric appears in them by declaring those:
// its value, its comparison by autonomy level and its trend over time. A
// sentence only ever quotes a known value, with its coverage. Each metric's
// trend and comparison as tables are on its own page (`report/metric-page.ts`).
import type { Dataset } from "./dataset.ts";
import { escapeHtml } from "./metrics/html.ts";
import { METRICS } from "./metrics/index.ts";
import type { Figure, Metric } from "./metrics/metric.ts";
import { coverageText } from "./metrics/stats.ts";
import { UNKNOWN } from "./metrics/metric.ts";

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


/** Every CV sentence of a dataset, keyed by what it quotes: `<metric>`, `<metric>:autonomy` or `<metric>:trend`. */
export function cvSentences(dataset: Dataset): { key: string; text: string }[] {
  const sentences: { key: string; text: string }[] = [];
  for (const metric of METRICS) {
    const result = dataset.metrics[metric.id];
    if (!metric.sentence || !result || result.value === UNKNOWN) continue;
    const text = metric.sentence(result.value);
    if (text !== undefined) sentences.push({ key: metric.id, text: `${text}, over ${coverageText(result.coverage)}.` });
  }

  for (const { metric, figure, results } of withFigures(dataset.byAutonomy)) {
    const full = results.full;
    if (typeof full.value !== "number") continue;
    const others = (["assisted", "manual"] as const).flatMap((level) => {
      const other = results[level];
      return typeof other.value !== "number" ? [] : [`${figure.format(other.value)} on ${level} ones (${coverageText(other.coverage)})`];
    });
    if (others.length === 0) continue;
    sentences.push({
      key: `${metric.id}:autonomy`,
      text: `${metric.name} (${figure.label}): ${figure.format(full.value)} on fully autonomous tickets (${coverageText(full.coverage)}), against ${others.join(" and ")}.`,
    });
  }

  const periods = dataset.trends?.periods ?? [];
  for (const { metric, figure, results } of withFigures(dataset.trends?.metrics)) {
    const known = results.flatMap((result, index) => {
      const period = periods[index]?.period;
      return typeof result.value !== "number" || period === undefined ? [] : [{ value: result.value, coverage: result.coverage, period }];
    });
    const from = known[0];
    const to = known.at(-1);
    if (!from || !to || known.length < 2) continue;
    sentences.push({
      key: `${metric.id}:trend`,
      text: `${metric.name} (${figure.label}) went from ${figure.format(from.value)} in ${monthName(from.period)} (${coverageText(from.coverage)}) to ${figure.format(to.value)} in ${monthName(to.period)} (${coverageText(to.coverage)}).`,
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
