// Every metric the CLI computes, in report order.
import type { Metric } from "./metric.ts";
import { autonomy } from "./autonomy.ts";
import { batchHealth } from "./batch-health.ts";
import { estimateVsActual } from "./estimate-vs-actual.ts";
import { firstRunCiRate } from "./first-run-ci.ts";
import { fixCyclesMetric } from "./fix-cycles.ts";
import { humanMessagesPerTicket } from "./human-messages.ts";
import { leadTime } from "./lead-time.ts";
import { orchestrationTime } from "./orchestration-time.ts";
import { netLinesRemoved } from "./net-lines-removed.ts";
import { regressionRate } from "./regression-rate.ts";
import { scheduledFailures } from "./scheduled-failures.ts";
import { size } from "./size.ts";
import { subAgents } from "./sub-agents.ts";
import { apiEquivalentCost } from "./api-equivalent-cost.ts";
import { testRatio } from "./test-ratio.ts";
import { throughput } from "./throughput.ts";

export const METRICS: readonly Metric<unknown>[] = [
  leadTime,
  throughput,
  firstRunCiRate,
  fixCyclesMetric,
  scheduledFailures,
  batchHealth,
  regressionRate,
  humanMessagesPerTicket,
  orchestrationTime,
  subAgents,
  apiEquivalentCost,
  autonomy,
  testRatio,
  netLinesRemoved,
  size,
  estimateVsActual,
];

export function findMetric(id: string): Metric<unknown> | undefined {
  return METRICS.find((metric) => metric.id === id);
}
