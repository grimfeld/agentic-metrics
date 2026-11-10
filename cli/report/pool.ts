// The overview's headline figures, pooled across repos. Only repos published
// `full` pool: an anonymized dataset keeps aggregates only, and two medians
// can't be pooled into one. Each headline metric pools its own results
// (`headline.pool`), into a value of its own shape, so its card renders it.
import type { Dataset } from "../dataset.ts";
import type { Metric, MetricResult } from "../metrics/metric.ts";
import { UNKNOWN } from "../metrics/metric.ts";
import { sum } from "../metrics/stats.ts";

export interface Pooled {
  result: MetricResult<unknown>;
  /** The `full` datasets whose data the value covers. */
  covers: Dataset[];
  /** The other `full` datasets: their value is unknown, or they predate the metric. */
  unknownFor: Dataset[];
}

/** `metric` pooled over the `full` datasets among `datasets`; unknown for a metric with no headline. */
export function pooled(metric: Metric<unknown>, datasets: readonly Dataset[]): Pooled {
  const full = datasets.filter((dataset) => dataset.publish === "full");
  const results = full.flatMap((dataset) => {
    const result = dataset.metrics[metric.id];
    return result ? [{ dataset, result }] : [];
  });
  const coverage = {
    tickets: sum(results.map(({ result }) => result.coverage.tickets)),
    of: sum(results.map(({ result }) => result.coverage.of)),
  };
  const known = results.flatMap(({ dataset, result: { value, coverage } }) => (value === UNKNOWN ? [] : [{ dataset, value, coverage }]));
  const value = metric.headline?.pool(known);
  if (value === undefined) return { result: { value: UNKNOWN, coverage }, covers: [], unknownFor: full };
  const covers = known.map(({ dataset }) => dataset);
  return { result: { value, coverage }, covers, unknownFor: full.filter((dataset) => !covers.includes(dataset)) };
}
