// The dataset: one JSON file per repo. It is what `collect` writes, what
// `report` reads, and what the report links as raw data. A `full` dataset
// also lists each delivered ticket's title and link; an `anonymized` one holds
// aggregates only, under an alias.
import { selectCandidates, type CaseStudyCandidate } from "./case-studies.ts";
import type { PublishMode } from "./config.ts";
import type { Repo } from "./github/load.ts";
import type { LinkedWork } from "./linker.ts";
import { METRICS } from "./metrics/index.ts";
import type { FigureResult, Metric, MetricResult } from "./metrics/metric.ts";
import { UNKNOWN } from "./metrics/metric.ts";
import { anonymizeByAutonomy, anonymizeTrends, byAutonomy, trends, type ByAutonomy, type Trends } from "./trends.ts";

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
  /** Each metric's figure per month of delivery. Absent from datasets written before trends. */
  trends?: Trends;
  /** Each metric's figure per autonomy level. Absent from datasets written before the comparison. */
  byAutonomy?: ByAutonomy;
  /** The repo's GitHub page. Absent when anonymized. */
  url?: string;
  /** Every delivered ticket with its title and link, in delivery order. Absent when anonymized. */
  ticketList?: DeliveredTicket[];
  /** Tickets flagged as case-study candidates, with the criteria each meets. Absent when anonymized. */
  caseStudyCandidates?: CaseStudyCandidate[];
}

/**
 * The dataset of `repo` under `publish`. An `anonymized` dataset carries the
 * alias in place of the repo's name, no titles or links, and each metric's
 * value only as that metric's `anonymize` keeps it.
 */
export function buildDataset(repo: Repo, work: LinkedWork, now: Date, publish: PublishMode, alias?: string): Dataset {
  const anonymized = publish === "anonymized";
  if (anonymized && !alias) throw new Error("an anonymized dataset needs an alias");
  const publishValue = <V>(metric: Metric<V>, value: V): V => (anonymized ? metric.anonymize(value) : value);
  const metrics = Object.fromEntries(
    METRICS.map((metric) => {
      const result = metric.compute(work);
      if (result.value === UNKNOWN) return [metric.id, result];
      return [metric.id, { ...result, value: publishValue(metric, result.value) }];
    }),
  );
  const monthly = trends(work, METRICS, publishValue);
  const byLevel = byAutonomy(work, METRICS, publishValue);
  const dataset: Dataset = {
    schemaVersion: SCHEMA_VERSION,
    repo: anonymized && alias ? alias : repo.fullName,
    publish,
    generatedAt: now.toISOString(),
    tickets: work.tickets.length,
    pullRequests: work.pullRequests.length,
    integrationPullRequests: work.integrationPullRequests.length,
    metrics,
    trends: anonymized ? anonymizeTrends(monthly) : monthly,
    byAutonomy: anonymized ? anonymizeByAutonomy(byLevel) : byLevel,
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
    caseStudyCandidates: selectCandidates(work),
  };
}

/** Where a repo's dataset lives, relative to the datasets folder: `<owner>/<name>.json`, or `<alias>.json`. */
export function datasetPath(repo: string): string {
  return `${repo}.json`;
}

/**
 * The dataset as the report reads it: unknown, never zero. `collect` already
 * writes a value over 0 tickets, or a repo-level value that measured nothing,
 * as unknown (see `Metric.repoLevel`); a dataset written before it did is read
 * the same way.
 */
export function asReported(dataset: Dataset): Dataset {
  const metrics = Object.fromEntries(
    Object.entries(dataset.metrics).map(([id, result]) => {
      const metric = METRICS.find((m) => m.id === id);
      const { value } = result;
      if (value === UNKNOWN) return [id, result];
      const known = metric?.repoLevel ? metric.repoLevel.measured(value) : result.coverage.tickets > 0;
      return [id, known ? result : { ...result, value: UNKNOWN }];
    }),
  );
  // A repo-level figure over a month or level is unknown when the value is: nothing measured overall, nothing in part.
  const figure = (id: string) => (result: FigureResult): FigureResult => {
    if (typeof result.value !== "number") return result;
    const repoLevel = METRICS.some((m) => m.id === id && m.repoLevel);
    const known = repoLevel ? metrics[id]?.value !== UNKNOWN : result.coverage.tickets > 0;
    return known ? result : { ...result, value: UNKNOWN };
  };
  const { trends, byAutonomy } = dataset;
  return {
    ...dataset,
    metrics,
    ...(trends && { trends: { ...trends, metrics: Object.fromEntries(Object.entries(trends.metrics).map(([id, results]) => [id, results.map(figure(id))])) } }),
    ...(byAutonomy && {
      byAutonomy: Object.fromEntries(
        Object.entries(byAutonomy).map(([id, levels]) => [id, Object.fromEntries(Object.entries(levels).map(([level, result]) => [level, figure(id)(result)]))]),
      ) as ByAutonomy,
    }),
  };
}
