// Trends over time and the comparison by autonomy level. Both run every metric
// that has a figure over a subset of the tickets (those delivered in a month,
// or those at an autonomy level) through its own `compute`, and keep one number
// per subset with its coverage within the subset. So any metric plugs in by
// declaring a figure: nothing here knows what a metric measures.
import { AUTONOMY_LEVELS, type AutonomyLevel } from "./autonomy.ts";
import { KINDS, kindOf } from "./conventions.ts";
import type { LinkedWork, Ticket } from "./linker.ts";
import type { FigureResult, Metric, MetricResult } from "./metrics/metric.ts";
import { SUPPRESSED, UNKNOWN } from "./metrics/metric.ts";
import { ticketSkills } from "./metrics/skills.ts";
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

/** The groups the comparison by kind of change keeps: each kind, and the tickets no label names. */
export const KIND_GROUPS = [...KINDS, "unknown"] as const;
export type KindGroup = (typeof KIND_GROUPS)[number];

/** Keyed by metric id: its figure over the tickets of each kind of change. A ticket labelled with two kinds counts under neither. */
export type ByKind = Record<string, Record<KindGroup, FigureResult>>;

/** A ticket's kind of change, from its labels. */
export function ticketKind(ticket: Ticket): ReturnType<typeof kindOf> {
  return kindOf(ticket.issue?.labels, ticket.pullRequests.flatMap((pr) => pr.labels));
}

/** `byKind` as an `anonymized` dataset publishes it: figures over too few tickets withheld. */
export function anonymizeByKind(byKind: ByKind): ByKind {
  return Object.fromEntries(
    Object.entries(byKind).map(([id, groups]) => [id, Object.fromEntries(KIND_GROUPS.map((group) => [group, suppress(groups[group])])) as Record<KindGroup, FigureResult>]),
  );
}

/**
 * The fewest tickets a figure may cover in an `anonymized` dataset. A month or
 * level with one or two tickets would publish those tickets' own numbers.
 */
export const MIN_ANONYMIZED_TICKETS = 3;

function suppress(result: FigureResult): FigureResult {
  return typeof result.value === "number" && result.coverage.tickets < MIN_ANONYMIZED_TICKETS ? { ...result, value: SUPPRESSED } : result;
}

/** `trends` as an `anonymized` dataset publishes it: figures over too few tickets withheld. */
export function anonymizeTrends(trends: Trends): Trends {
  return {
    periods: trends.periods,
    metrics: Object.fromEntries(Object.entries(trends.metrics).map(([id, results]) => [id, results.map(suppress)])),
  };
}

/** `byAutonomy` as an `anonymized` dataset publishes it: figures over too few tickets withheld. */
export function anonymizeByAutonomy(byAutonomy: ByAutonomy): ByAutonomy {
  return Object.fromEntries(
    Object.entries(byAutonomy).map(([id, levels]) => [
      id,
      Object.fromEntries(AUTONOMY_LEVELS.map((level) => [level, suppress(levels[level])])) as Record<AutonomyLevel, FigureResult>,
    ]),
  );
}

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

export function byKind(work: LinkedWork, metrics: readonly Metric<unknown>[], publish: Publish): ByKind {
  const slices = KIND_GROUPS.map((group) => [group, sliceWork(work, work.tickets.filter((ticket) => ticketKind(ticket) === group))] as const);
  return Object.fromEntries(
    metrics
      .filter((metric) => metric.figure && metric.figure.byAutonomy !== false)
      .map((metric) => [metric.id, Object.fromEntries(slices.map(([group, slice]) => [group, figureOf(metric, metric.compute(slice), (value) => publish(metric, value))]))]),
  ) as ByKind;
}

/** A skill gets a comparison once this many tickets used it: fewer, and the comparison is noise. */
export const MIN_SKILL_TICKETS = 5;

/** Per skill used on MIN_SKILL_TICKETS tickets or more: each metric's figure over the tickets that used it, and over those with transcripts that didn't. */
export type BySkill = Record<string, { tickets: number; metrics: Record<string, { with: FigureResult; without: FigureResult }> }>;

export function bySkill(work: LinkedWork, metrics: readonly Metric<unknown>[], publish: Publish): BySkill {
  const used = new Map<Ticket, Set<string>>();
  for (const ticket of work.tickets) {
    const uses = ticketSkills(ticket);
    if (uses) used.set(ticket, new Set(uses.map((use) => use.name)));
  }
  const counts = new Map<string, number>();
  for (const names of used.values()) for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  const compared = metrics.filter((metric) => metric.figure && metric.figure.byAutonomy !== false && metric.id !== "skills");
  const out: BySkill = {};
  for (const [name, tickets] of [...counts].sort(([a], [b]) => a.localeCompare(b))) {
    if (tickets < MIN_SKILL_TICKETS) continue;
    const withSkill = sliceWork(work, [...used].filter(([, names]) => names.has(name)).map(([ticket]) => ticket));
    const without = sliceWork(work, [...used].filter(([, names]) => !names.has(name)).map(([ticket]) => ticket));
    out[name] = {
      tickets,
      metrics: Object.fromEntries(
        compared.map((metric) => [
          metric.id,
          {
            with: figureOf(metric, metric.compute(withSkill), (value) => publish(metric, value)),
            without: figureOf(metric, metric.compute(without), (value) => publish(metric, value)),
          },
        ]),
      ),
    };
  }
  return out;
}
