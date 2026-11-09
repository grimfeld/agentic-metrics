// The dataset: one JSON file per repo. It is what `collect` writes, what
// `report` reads, and what the report links as raw data. A `full` dataset
// also lists each delivered ticket's title and link; an `anonymized` one holds
// aggregates only, under an alias.
import type { PublishMode } from "./config.ts";
import type { Repo } from "./github/load.ts";
import type { LinkedWork } from "./linker.ts";
import { METRICS } from "./metrics/index.ts";
import type { MetricResult } from "./metrics/metric.ts";
import { UNKNOWN } from "./metrics/metric.ts";

export const SCHEMA_VERSION = 2;

export interface DeliveredTicket {
  /** `#104` or `PR #136`, as in the linker. */
  id: string;
  title: string;
  url: string;
  doneAt: string;
}

export interface Dataset {
  schemaVersion: number;
  /** `owner/name`, or the alias of an `anonymized` repo. */
  repo: string;
  /** A `none` dataset only ever lives in a local report. */
  publish: PublishMode;
  generatedAt: string;
  /** Tickets delivered: issues closed by, or PRs merged into, the default branch. */
  tickets: number;
  /** Ticket PRs delivered to the default branch (no integration PR, nothing excluded). */
  pullRequests: number;
  /** Integration (batch) PRs merged into the default branch; in no ticket metric. */
  integrationPullRequests: number;
  /** Keyed by metric id. A metric this version doesn't compute is absent. */
  metrics: Record<string, MetricResult<unknown>>;
  /** The repo's GitHub page. Absent when anonymized. */
  url?: string;
  /** Every delivered ticket with its title and link, in delivery order. Absent when anonymized. */
  ticketList?: DeliveredTicket[];
}

/**
 * The dataset of `repo` under `publish`. An `anonymized` dataset carries the
 * alias in place of the repo's name, no titles or links, and each metric's
 * value only as that metric's `anonymize` keeps it.
 */
export function buildDataset(repo: Repo, work: LinkedWork, now: Date, publish: PublishMode, alias?: string): Dataset {
  const anonymized = publish === "anonymized";
  if (anonymized && !alias) throw new Error("an anonymized dataset needs an alias");
  const metrics = Object.fromEntries(
    METRICS.map((metric) => {
      const result = metric.compute(work);
      if (!anonymized || result.value === UNKNOWN) return [metric.id, result];
      return [metric.id, { ...result, value: metric.anonymize(result.value) }];
    }),
  );
  const dataset: Dataset = {
    schemaVersion: SCHEMA_VERSION,
    repo: anonymized && alias ? alias : repo.fullName,
    publish,
    generatedAt: now.toISOString(),
    tickets: work.tickets.length,
    pullRequests: work.pullRequests.length,
    integrationPullRequests: work.integrationPullRequests.length,
    metrics,
  };
  if (anonymized) return dataset;
  return {
    ...dataset,
    url: repo.url,
    ticketList: work.tickets.map((ticket) => {
      // A ticket whose issue GitHub did not return falls back to its first PR.
      const source = ticket.issue ?? ticket.pullRequests[0];
      return { id: ticket.id, title: source?.title ?? "", url: source?.url ?? "", doneAt: ticket.doneAt.toISOString() };
    }),
  };
}

/** Where a repo's dataset lives, relative to the datasets folder: `<owner>/<name>.json`, or `<alias>.json`. */
export function datasetPath(repo: string): string {
  return `${repo}.json`;
}
