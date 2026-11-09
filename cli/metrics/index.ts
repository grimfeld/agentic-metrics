// Every metric the CLI computes, in report order.
import type { Metric } from "./metric.ts";
import { leadTime } from "./lead-time.ts";
import { regressionRate } from "./regression-rate.ts";
import { throughput } from "./throughput.ts";

export const METRICS: readonly Metric<unknown>[] = [leadTime, throughput, regressionRate];

export function findMetric(id: string): Metric<unknown> | undefined {
  return METRICS.find((metric) => metric.id === id);
}
