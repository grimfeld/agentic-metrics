// Every metric the CLI computes, in report order.
import type { Metric } from "./metric.ts";
import { leadTime } from "./lead-time.ts";
import { throughput } from "./throughput.ts";

export const METRICS: readonly Metric<unknown>[] = [leadTime, throughput];

export function findMetric(id: string): Metric<unknown> | undefined {
  return METRICS.find((metric) => metric.id === id);
}
