// Every metric the CLI computes, in report order.
import type { Metric } from "./metric.ts";
import { activeTime, estimatedActiveTime } from "./active-time.ts";
import { attempts } from "./attempts.ts";
import { autonomy } from "./autonomy.ts";
import { batchHealth } from "./batch-health.ts";
import { estimateVsActual } from "./estimate-vs-actual.ts";
import { firstRunCiRate } from "./first-run-ci.ts";
import { fixCycles } from "./fix-cycles.ts";
import { friction } from "./friction.ts";
import { humanMessagesPerTicket } from "./human-messages.ts";
import { leadTime } from "./lead-time.ts";
import { orchestrationTime } from "./orchestration-time.ts";
import { netLinesRemoved } from "./net-lines-removed.ts";
import { regressionRate } from "./regression-rate.ts";
import { scheduledFailures } from "./scheduled-failures.ts";
import { size } from "./size.ts";
import { skills } from "./skills.ts";
import { subAgents } from "./sub-agents.ts";
import { apiEquivalentCost } from "./api-equivalent-cost.ts";
import { testRatio } from "./test-ratio.ts";
import { throughput } from "./throughput.ts";

export const METRICS: readonly Metric<unknown>[] = [
  activeTime,
  estimatedActiveTime,
  leadTime,
  throughput,
  attempts,
  firstRunCiRate,
  fixCycles,
  scheduledFailures,
  batchHealth,
  regressionRate,
  humanMessagesPerTicket,
  friction,
  orchestrationTime,
  subAgents,
  skills,
  apiEquivalentCost,
  autonomy,
  testRatio,
  netLinesRemoved,
  size,
  estimateVsActual,
];
