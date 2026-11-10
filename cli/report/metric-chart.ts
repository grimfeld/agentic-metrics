// A metric's own chart, drawn from a repo's dataset through the metric's chart
// hook: the repo page's grid uses it, and so can the metric's page. A metric
// whose value is unknown gets "unknown", never an empty or zero chart.
import type { Dataset } from "../dataset.ts";
import type { Metric } from "../metrics/metric.ts";
import { UNKNOWN } from "../metrics/metric.ts";
import { renderChart, type ChartInput } from "./charts.ts";

/** What the metric's chart hook is given, or undefined when its value is unknown or missing. */
export function chartInput(dataset: Dataset, metric: Metric<unknown>): ChartInput<unknown> | undefined {
  const result = dataset.metrics[metric.id];
  if (!result || result.value === UNKNOWN) return undefined;
  const periods = dataset.trends?.periods ?? [];
  const trend = dataset.trends?.metrics[metric.id] ?? [];
  const byAutonomy = dataset.byAutonomy?.[metric.id];
  return {
    value: result.value,
    trend: periods.flatMap(({ period }, i) => {
      const figure = trend[i];
      return figure ? [{ period, result: figure }] : [];
    }),
    ...(byAutonomy ? { byAutonomy } : {}),
  };
}

/**
 * The metric's chart (HTML: an accessible `<svg>` and its numbers as a
 * table), or `unknown`. Empty when the metric declares no chart. `id` must be
 * unique on the page.
 */
export function metricChart(dataset: Dataset, metric: Metric<unknown>, id = `chart-${metric.id}`): string {
  if (!metric.chart) return "";
  const input = chartInput(dataset, metric);
  if (!input) return `<p class="unknown">unknown</p>`;
  return renderChart(metric.chart.draw(input), { id, title: metric.chart.title });
}
