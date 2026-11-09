// Trends over time and the comparison by autonomy level. Both run every metric
// that has a figure over a subset of the tickets (those delivered in a month,
// or those at an autonomy level) through its own `compute`, and keep one number
// per subset with its coverage within the subset. So any metric plugs in by
// declaring a figure: nothing here knows what a metric measures.
import { AUTONOMY_LEVELS, type AutonomyLevel } from "./autonomy.ts";
import type { LinkedWork, Ticket } from "./linker.ts";
import type { FigureResult, Metric, MetricResult } from "./metrics/metric.ts";
import { UNKNOWN } from "./metrics/metric.ts";
import type { PullRequest, WorkflowRun } from "./github/load.ts";
import type { Session } from "./transcripts/load.ts";

export interface Trends {
  /** Calendar months (UTC, `YYYY-MM`) in which tickets were delivered; months with none are left out. */
  periods: { period: string; tickets: number }[];
  /** Keyed by metric id: its figure in each period, in the order of `periods`. */
  metrics: Record<string, FigureResult[]>;
}

/** Keyed by metric id: its figure over the tickets at each autonomy level. */
export type ByAutonomy = Record<string, Record<AutonomyLevel, FigureResult>>;

/** The month a date falls in, as `YYYY-MM` (UTC). */
export function monthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * The work restricted to `tickets`: their PRs, and the CI runs of those PRs
 * (reached through the PRs). Every regression stays: one counts against the
 * tickets it names, if they are kept. What no ticket owns (orchestration
 * sessions, batches, CI runs other than a PR's, like scheduled ones) is kept
 * when it happened `within` the slice's time window; without a window, only
 * batches tied to the tickets are kept, and no orchestration session.
 */
export function sliceWork(work: LinkedWork, tickets: Ticket[], within?: (date: Date) => boolean): LinkedWork {
  const pullRequests = new Set(tickets.flatMap((ticket) => ticket.pullRequests));
  const branches = new Set([...pullRequests].map((pr) => pr.baseRefName));
  const closing = new Set(tickets.flatMap((ticket) => ticket.integrationPullRequests));
  const batch = within ? (pr: PullRequest) => within(pr.mergedAt) : (pr: PullRequest) => closing.has(pr) || branches.has(pr.headRefName);
  const run = (run: WorkflowRun) => run.event === "pull_request" || (within?.(run.createdAt) ?? true);
  const session = (session: Session) => within !== undefined && session.startedAt !== undefined && within(session.startedAt);
  return {
    ...work,
    tickets,
    pullRequests: work.pullRequests.filter((pr) => pullRequests.has(pr)),
    integrationPullRequests: work.integrationPullRequests.filter(batch),
    ci: { ...work.ci, runs: work.ci.runs.filter(run) },
    transcripts: { ...work.transcripts, orchestration: work.transcripts.orchestration.filter(session) },
  };
}

/** A metric's figure from one of its results, the value as `publish` turns it. */
function figureOf<V>(metric: Metric<V>, result: MetricResult<V>, publish: (value: V) => V): FigureResult {
  if (!metric.figure || result.value === UNKNOWN) return { value: UNKNOWN, coverage: result.coverage };
  const figure = metric.figure.of(publish(result.value));
  return { value: Number.isFinite(figure) ? figure : UNKNOWN, coverage: result.coverage };
}

type Publish = <V>(metric: Metric<V>, value: V) => V;

export function trends(work: LinkedWork, metrics: readonly Metric<unknown>[], publish: Publish): Trends {
  const months = new Map<string, Ticket[]>();
  for (const ticket of work.tickets) {
    const month = monthOf(ticket.doneAt);
    months.set(month, [...(months.get(month) ?? []), ticket]);
  }
  const periods = [...months.keys()].sort();
  const slices = periods.map((period) =>
    sliceWork(work, months.get(period) ?? [], (date) => monthOf(date) === period),
  );
  return {
    periods: periods.map((period) => ({ period, tickets: months.get(period)?.length ?? 0 })),
    metrics: Object.fromEntries(
      metrics
        .filter((metric) => metric.figure)
        .map((metric) => [metric.id, slices.map((slice) => figureOf(metric, metric.compute(slice), (value) => publish(metric, value)))]),
    ),
  };
}

export function byAutonomy(work: LinkedWork, metrics: readonly Metric<unknown>[], publish: Publish): ByAutonomy {
  const slices = AUTONOMY_LEVELS.map((level) => [level, sliceWork(work, work.tickets.filter((ticket) => ticket.autonomy?.level === level))] as const);
  return Object.fromEntries(
    metrics
      .filter((metric) => metric.figure && metric.figure.byAutonomy !== false)
      .map((metric) => [
        metric.id,
        Object.fromEntries(slices.map(([level, slice]) => [level, figureOf(metric, metric.compute(slice), (value) => publish(metric, value))])),
      ]),
  ) as ByAutonomy;
}
