// Every metric the CLI computes, in report order.
import type { Metric } from "./metric.ts";
import { estimateVsActual } from "./estimate-vs-actual.ts";
import { leadTime } from "./lead-time.ts";
import { netLinesRemoved } from "./net-lines-removed.ts";
import { regressionRate } from "./regression-rate.ts";
import { size } from "./size.ts";
import { testRatio } from "./test-ratio.ts";
import { throughput } from "./throughput.ts";

export const METRICS: readonly Metric<unknown>[] = [
  leadTime,
  throughput,
  regressionRate,
  testRatio,
  netLinesRemoved,
  size,
  estimateVsActual,
];

export function findMetric(id: string): Metric<unknown> | undefined {
  return METRICS.find((metric) => metric.id === id);
}
