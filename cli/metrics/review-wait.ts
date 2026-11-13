// Review wait: how long a PR waited from being ready for review to its first
// review by a person, and how many rounds of review it went through. Apart
// from lead time's phases, which stay as they are: review and CI overlap, so
// landing wait is not split.
import { pullRequestRuns, type Ci } from "../ci.ts";
import type { PullRequest } from "../github/load.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { formatDuration, hoursBetween, percentile, plural, round, sum } from "./stats.ts";

export interface ReviewWait {
  /** Hours from ready for review to the first review, over the PRs a person reviewed. */
  p50Hours: number;
  p90Hours: number;
  reviewed: number;
  /** PRs merged with no review by a person. */
  unreviewed: number;
  /** Rounds of review per reviewed PR. */
  rounds: { p50: number; mean: number };
  /** Per reviewed PR, by number. Absent once anonymized. */
  perPullRequest?: { pullRequest: number; hours: number; rounds: number }[];
}

/** When a PR became ready for review: when it was marked ready, else when it opened. */
function readyAt(pr: PullRequest): Date {
  return pr.readyForReviewAt ?? pr.createdAt;
}

/**
 * Rounds of review: the stretches between two pushes (each push timed by its
 * first CI run) holding a review by a person that requested changes or
 * commented. A PR with no CI run is one stretch.
 */
export function reviewRounds(pr: PullRequest, ci: Ci): number {
  const pushes = new Map<string, number>();
  for (const run of pullRequestRuns(pr, ci)) if (!pushes.has(run.headSha)) pushes.set(run.headSha, run.createdAt.getTime());
  const bounds = [...pushes.values()].sort((a, b) => a - b).slice(1);
  const asking = (pr.reviews ?? []).filter((review) => !review.byBot && (review.state === "CHANGES_REQUESTED" || review.state === "COMMENTED"));
  const stretch = (at: Date) => bounds.filter((bound) => bound <= at.getTime()).length;
  return new Set(asking.map((review) => stretch(review.at))).size;
}

export const reviewWait: Metric<ReviewWait> = {
  id: "reviewWait",
  name: "Review wait",

  compute({ tickets, ci }) {
    const prs = tickets.flatMap((ticket) => ticket.pullRequests);
    // Reviews are read with the history; a dataset of PRs read before has none to judge.
    if (prs.length === 0 || prs.some((pr) => pr.reviews === undefined)) return { value: UNKNOWN, coverage: { tickets: 0, of: tickets.length } };
    const rows = new Map<PullRequest, { hours: number; rounds: number }>();
    for (const pr of prs) {
      const ready = readyAt(pr);
      const first = (pr.reviews ?? []).find((review) => !review.byBot && review.at >= ready);
      if (first) rows.set(pr, { hours: round(hoursBetween(ready, first.at), 2), rounds: reviewRounds(pr, ci) });
    }
    const coverage = { tickets: tickets.filter((ticket) => ticket.pullRequests.some((pr) => rows.has(pr))).length, of: tickets.length };
    const unreviewed = new Set(prs).size - rows.size;
    if (rows.size === 0) return { value: UNKNOWN, coverage };
    const hours = [...rows.values()].map((row) => row.hours);
    const rounds = [...rows.values()].map((row) => row.rounds);
    return {
      value: {
        p50Hours: percentile(hours, 50),
        p90Hours: percentile(hours, 90),
        reviewed: rows.size,
        unreviewed,
        rounds: { p50: percentile(rounds, 50), mean: round(sum(rounds) / rounds.length, 2) },
        perPullRequest: [...rows].map(([pr, row]) => ({ pullRequest: pr.number, ...row })).sort((a, b) => a.pullRequest - b.pullRequest),
      },
      coverage,
    };
  },

  anonymize: ({ p50Hours, p90Hours, reviewed, unreviewed, rounds }) => ({ p50Hours, p90Hours, reviewed, unreviewed, rounds }),

  figure: { label: "p50", of: ({ p50Hours }) => p50Hours, format: formatDuration },

  section({ p50Hours, p90Hours, reviewed, unreviewed, rounds }) {
    return `<p>A PR waited a median <strong>${formatDuration(p50Hours)}</strong> for its first review by a person (p90 ${formatDuration(p90Hours)}), over ${plural(reviewed, "reviewed PR")}; ${plural(unreviewed, "PR")} merged with no review.</p>
<p>Reviewed PRs went through a median of <strong>${String(rounds.p50)}</strong> rounds of review (mean ${String(rounds.mean)}).</p>`;
  },

  ticketTable: {
    rowHeading: "PR",
    columns: ["Wait for first review", "Rounds"],
    rows: ({ perPullRequest }) =>
      perPullRequest?.map((row) => ({
        id: `PR #${String(row.pullRequest)}`,
        cells: [
          { text: formatDuration(row.hours), sort: row.hours },
          { text: String(row.rounds), sort: row.rounds },
        ],
      })),
  },

  sentence: ({ p50Hours, reviewed }) => `Pull requests waited a median ${formatDuration(p50Hours)} for their first review (${plural(reviewed, "reviewed PR")})`,

  methodology: {
    definition:
      "For each delivered ticket PR: the time from it being ready for review (its last <code>ReadyForReviewEvent</code>, for a PR opened as a draft, else its opening) to its first review by a person (a review submitted by a bot is not one), as the median (p50) and 90th percentile (p90, nearest rank) over the PRs a person reviewed. <strong>Rounds of review</strong>: the stretches between two pushes (each push timed by the first CI run on its head commit) holding a review by a person that requested changes or commented; a PR with no CI run is one stretch. Lead time's phases are unchanged: review and CI overlap, so landing wait is not split.",
    limits:
      "A PR merged with no review is counted as unreviewed and left out of the wait. Review comments left outside a review (a plain PR comment) are not reviews. Pushes that triggered no CI run are not seen, so two rounds between them count as one. Only a PR's first 100 reviews are read.",
  },
};
