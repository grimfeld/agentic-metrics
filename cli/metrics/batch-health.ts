import { firstResult } from "../ci.ts";
import type { PullRequest } from "../github/load.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { formatPercent, percent, plural, share } from "./stats.ts";

export interface BatchHealth {
  /** Integration PRs merged into the default branch. */
  batches: number;
  /** Of those, the ones with a first CI result. */
  withCi: number;
  greenOnFirstRun: number;
  /** `greenOnFirstRun / withCi`, 0 to 1; absent when no batch has a CI result. */
  greenRate?: number;
  /** PRs dropped from a batch, counted once per batch that dropped them. */
  dropped: number;
  /** Each batch, oldest first. Absent once anonymized. */
  perBatch?: { pullRequest: number; firstRun: "passed" | "failed" | "unknown"; dropped: number[] }[];
}

/**
 * GitHub marks the PRs a batch lands as merged when the batch's merge commit
 * reaches the default branch, seconds after the batch itself.
 */
const LANDING_GRACE_MS = 5 * 60 * 1000;

/** PRs a batch names (`#N` in its title or body) that merged only after it: it did not land them. */
function droppedFrom(batch: PullRequest, delivered: Map<number, PullRequest>): number[] {
  return batch.references.filter((number) => {
    const pr = delivered.get(number);
    return pr !== undefined && pr.mergedAt.getTime() > batch.mergedAt.getTime() + LANDING_GRACE_MS;
  });
}

export const batchHealth: Metric<BatchHealth> = {
  id: "batchHealth",
  name: "Batch health",

  // Repo level: batches are no ticket, so it covers every ticket's period.
  compute({ tickets, pullRequests, integrationPullRequests, ci }) {
    const coverage = { tickets: tickets.length, of: tickets.length };
    if (integrationPullRequests.length === 0) return { value: UNKNOWN, coverage };
    const delivered = new Map(pullRequests.map((pr) => [pr.number, pr]));
    const perBatch = [...integrationPullRequests]
      .sort((a, b) => a.mergedAt.getTime() - b.mergedAt.getTime())
      .map((batch) => ({
        pullRequest: batch.number,
        firstRun: firstResult(batch, ci) ?? (UNKNOWN as typeof UNKNOWN),
        dropped: droppedFrom(batch, delivered),
      }));
    const withCi = perBatch.filter((batch) => batch.firstRun !== UNKNOWN).length;
    const greenOnFirstRun = perBatch.filter((batch) => batch.firstRun === "passed").length;
    return {
      value: {
        batches: perBatch.length,
        withCi,
        greenOnFirstRun,
        ...(withCi > 0 ? { greenRate: share(greenOnFirstRun, withCi) } : {}),
        dropped: perBatch.reduce((sum, batch) => sum + batch.dropped.length, 0),
        perBatch,
      },
      coverage,
    };
  },

  anonymize: ({ batches, withCi, greenOnFirstRun, greenRate, dropped }) => ({
    batches,
    withCi,
    greenOnFirstRun,
    ...(greenRate === undefined ? {} : { greenRate }),
    dropped,
  }),

  // Batches are no ticket's: a trend over time, no comparison by autonomy level.
  figure: { label: "green on first run", of: ({ greenRate }) => (greenRate === undefined ? Number.NaN : percent(greenRate)), format: formatPercent, byAutonomy: false },

  sentence: ({ batches, withCi, greenOnFirstRun, greenRate }) =>
    greenRate === undefined
      ? undefined
      : `${formatPercent(percent(greenRate))} of integration batches passed CI on their first run (${String(greenOnFirstRun)} of ${String(withCi)}, over ${String(batches)} batches)`,

  section({ batches, withCi, greenOnFirstRun, greenRate, dropped }) {
    const green =
      greenRate === undefined
        ? `No batch has a CI result`
        : `<strong>${formatPercent(percent(greenRate))}</strong> of batches were green on their first CI run (${String(greenOnFirstRun)} of ${String(withCi)})`;
    return `<p>${green}; ${plural(dropped, "PR")} dropped from ${plural(batches, "batch", "batches")}.</p>`;
  },

  ticketTable: {
    rowHeading: "Batch",
    columns: ["First CI run", "Dropped PRs", "Dropped"],
    rows: ({ perBatch }) =>
      perBatch?.map((batch) => ({
        id: `PR #${String(batch.pullRequest)}`,
        cells: [batch.firstRun, { text: String(batch.dropped.length), sort: batch.dropped.length }, batch.dropped.map((n) => `#${String(n)}`).join(", ")],
      })),
  },

  methodology: {
    definition:
      "Integration (batch) PRs merged into the default branch, recognised by the per-repo branch prefix. Green on first run: the batch's first CI result passed, judged as for the first-run CI rate (first attempt of the first run of the main check workflow). Dropped: a PR the batch names (<code>#N</code> in its title or description) that did not land with it, i.e. merged more than five minutes after the batch did. A PR dropped by two batches counts twice.",
    limits:
      "Drops are seen only through the batch's final description: a PR removed from it without a trace (an edit that deletes its line) is not seen, and neither is a PR that was dropped and never merged. Batches closed without merging are not read. Coverage is every ticket, since batches are not tickets.",
  },
};
