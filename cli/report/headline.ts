// The headline metrics, and a headline value as the report shows it: the
// metric's own card for a known value, `unknown` otherwise.
import { METRICS } from "../metrics/index.ts";
import type { Dataset } from "../dataset.ts";
import { escapeHtml } from "../metrics/html.ts";
import type { Metric, MetricResult } from "../metrics/metric.ts";
import { UNKNOWN } from "../metrics/metric.ts";

/** The metrics with a headline card, in card order. */
export const HEADLINES = METRICS.filter((metric) => metric.headline).sort((a, b) => (a.headline?.order ?? 0) - (b.headline?.order ?? 0));

/** HTML; a metric missing from a dataset written before it existed is unknown too. */
export function headlineValue(metric: Metric<unknown>, result: MetricResult<unknown> | undefined): string {
  if (!result || result.value === UNKNOWN || !metric.headline) return `<span class="unknown">unknown</span>`;
  return metric.headline.card(result.value);
}

/** The metric's figure on a tile: its headline card when it has one, else its trend figure. HTML. */
export function tileValue(metric: Metric<unknown>, dataset: Dataset): string {
  const result = dataset.metrics[metric.id];
  if (metric.headline || !result || result.value === UNKNOWN || !metric.figure) return headlineValue(metric, result);
  const figure = metric.figure.of(result.value);
  if (!Number.isFinite(figure)) return headlineValue(metric, undefined);
  return `${escapeHtml(metric.figure.format(figure))} <small>${escapeHtml(metric.figure.label)}</small>`;
}
