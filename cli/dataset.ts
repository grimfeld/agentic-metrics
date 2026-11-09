// The dataset: one JSON file per repo, aggregates only. It is what `collect`
// writes, what `report` reads, and what the report links as raw data.
import type { LinkedWork } from "./linker.ts";
import { METRICS } from "./metrics/index.ts";
import type { MetricResult } from "./metrics/metric.ts";

export const SCHEMA_VERSION = 1;

export interface Dataset {
  schemaVersion: number;
  /** `owner/name` */
  repo: string;
  generatedAt: string;
  /** Tickets delivered: issues closed by, or PRs merged into, the default branch. */
  tickets: number;
  /** PRs merged into the default branch. */
  pullRequests: number;
  /** Keyed by metric id. A metric this version doesn't compute is absent. */
  metrics: Record<string, MetricResult<unknown>>;
}

export function buildDataset(repo: string, work: LinkedWork, now: Date): Dataset {
  return {
    schemaVersion: SCHEMA_VERSION,
    repo,
    generatedAt: now.toISOString(),
    tickets: work.tickets.length,
    pullRequests: work.pullRequests.length,
    metrics: Object.fromEntries(METRICS.map((metric) => [metric.id, metric.compute(work)])),
  };
}

/** Where a repo's dataset lives, relative to the datasets folder. */
export function datasetPath(repo: string): string {
  return `${repo}.json`;
}
