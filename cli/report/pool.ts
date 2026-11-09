// The overview's headline figures, pooled across repos. Only repos published
// `full` pool: an anonymized dataset keeps aggregates only, and two medians
// can't be pooled into one. Each pooled value has the shape of the metric's
// own value, so the metric's headline card renders it.
import type { Dataset } from "../dataset.ts";
import type { FirstRunCiRate } from "../metrics/first-run-ci.ts";
import type { HumanMessages } from "../metrics/human-messages.ts";
import type { LeadTime } from "../metrics/lead-time.ts";
import type { Coverage, Metric, MetricResult } from "../metrics/metric.ts";
import { UNKNOWN } from "../metrics/metric.ts";
import type { RegressionRate } from "../metrics/regression-rate.ts";
import { percentile, round, share } from "../metrics/stats.ts";

interface Known<V> {
  value: V;
  coverage: Coverage;
}

/** Pools the known results of several repos into one value; undefined when they give nothing to pool. */
type Pool<V> = (known: Known<V>[]) => V | undefined;

const sum = (numbers: number[]) => numbers.reduce((total, n) => total + n, 0);

const leadTime: Pool<LeadTime> = (known) => {
  const hours = known.flatMap(({ value }) => (value.tickets ?? []).map((row) => row.hours));
  if (hours.length === 0) return undefined;
  return { p50Hours: round(percentile(hours, 50), 1), p90Hours: round(percentile(hours, 90), 1) };
};

const firstRunCiRate: Pool<FirstRunCiRate> = (known) => {
  const passed = sum(known.map(({ value }) => value.passed));
  const pullRequests = sum(known.map(({ value }) => value.pullRequests));
  return pullRequests === 0 ? undefined : { rate: share(passed, pullRequests), passed, pullRequests };
};

const humanMessagesPerTicket: Pool<HumanMessages> = (known) => {
  const counts = known.flatMap(({ value }) => (value.perTicket ?? []).map((row) => row.messages));
  if (counts.length === 0) return undefined;
  return { p50: percentile(counts, 50), p90: percentile(counts, 90), mean: round(sum(counts) / counts.length, 1) };
};

const regressionRate: Pool<RegressionRate> = (known) => {
  const tickets = sum(known.map(({ coverage }) => coverage.tickets));
  if (tickets === 0) return undefined;
  const regressedTickets = sum(known.map(({ value }) => value.regressedTickets));
  return { rate: share(regressedTickets, tickets), regressions: sum(known.map(({ value }) => value.regressions)), regressedTickets };
};

/** A pool among others of any value: each is only ever given its own metric's results. */
const any = <V>(pool: Pool<V>) => pool as unknown as Pool<unknown>;

/** How each headline metric pools, by id. A headline metric missing here shows as unknown on the overview. */
const POOLS: Record<string, Pool<unknown> | undefined> = {
  leadTime: any(leadTime),
  firstRunCiRate: any(firstRunCiRate),
  humanMessagesPerTicket: any(humanMessagesPerTicket),
  regressionRate: any(regressionRate),
};

export interface Pooled {
  result: MetricResult<unknown>;
  /** The `full` datasets whose data the value covers. */
  covers: Dataset[];
}

/** `metric` pooled over the `full` datasets among `datasets`. */
export function pooled(metric: Metric<unknown>, datasets: readonly Dataset[]): Pooled {
  const results = datasets.flatMap((dataset) => {
    const result = dataset.metrics[metric.id];
    return dataset.publish === "full" && result ? [{ dataset, result }] : [];
  });
  const coverage = {
    tickets: sum(results.map(({ result }) => result.coverage.tickets)),
    of: sum(results.map(({ result }) => result.coverage.of)),
  };
  const known = results.filter(({ result }) => result.value !== UNKNOWN);
  const pool = POOLS[metric.id];
  const value = pool?.(known.map(({ result }) => ({ value: result.value, coverage: result.coverage })));
  if (value === undefined) return { result: { value: UNKNOWN, coverage }, covers: [] };
  return { result: { value, coverage }, covers: known.map(({ dataset }) => dataset) };
}
