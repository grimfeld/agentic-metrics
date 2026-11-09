import { pullRequestRuns, verdict, type Ci } from "../ci.ts";
import type { PullRequest } from "../github/load.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";

export interface FixCycles {
  /** Mean fix cycles per PR with a CI run, to two decimals. */
  perPullRequest: number;
  total: number;
  /** PRs with a CI run. */
  pullRequests: number;
  /** The PRs that needed at least one fix cycle, by number. Absent once anonymized. */
  withFixCycles?: { pullRequest: number; fixCycles: number }[];
}

/**
 * A PR's fix cycles, or undefined when it has no CI run. Its pushes are the
 * head commits its `pull_request` runs ran on, in order; a push is a fix cycle
 * when a run on the head before it failed (on any attempt GitHub shows), or a
 * review requested changes between the two pushes.
 */
function fixCycles(pr: PullRequest, ci: Ci): number | undefined {
  const pushes: { sha: string; at: Date; failed: boolean }[] = [];
  for (const run of pullRequestRuns(pr, ci)) {
    let push = pushes.find((p) => p.sha === run.headSha);
    if (!push) pushes.push((push = { sha: run.headSha, at: run.createdAt, failed: false }));
    if (verdict(run.firstAttemptConclusion) === "failed" || verdict(run.conclusion) === "failed") push.failed = true;
  }
  if (pushes.length === 0) return undefined;
  let cycles = 0;
  for (let i = 1; i < pushes.length; i++) {
    const before = pushes[i - 1];
    const push = pushes[i];
    if (!before || !push) continue;
    const reviewed = pr.changesRequestedAt.some((at) => at > before.at && at <= push.at);
    if (before.failed || reviewed) cycles++;
  }
  return cycles;
}

export const fixCyclesMetric: Metric<FixCycles> = {
  id: "fixCycles",
  name: "Fix cycles per PR",

  compute({ tickets, ci }) {
    const counts = new Map(tickets.flatMap((ticket) => ticket.pullRequests).map((pr) => [pr, fixCycles(pr, ci)]));
    const covered = tickets.filter((ticket) => ticket.pullRequests.some((pr) => counts.get(pr) !== undefined));
    const coverage = { tickets: covered.length, of: tickets.length };
    const measured = [...counts.entries()].flatMap(([pr, count]) => (count === undefined ? [] : [{ pullRequest: pr.number, fixCycles: count }]));
    if (measured.length === 0) return { value: UNKNOWN, coverage };
    const total = measured.reduce((sum, row) => sum + row.fixCycles, 0);
    return {
      value: {
        perPullRequest: Math.round((total / measured.length) * 100) / 100,
        total,
        pullRequests: measured.length,
        withFixCycles: measured.filter((row) => row.fixCycles > 0).sort((a, b) => a.pullRequest - b.pullRequest),
      },
      coverage,
    };
  },

  anonymize: ({ perPullRequest, total, pullRequests }) => ({ perPullRequest, total, pullRequests }),

  figure: { label: "per PR", of: ({ perPullRequest }) => perPullRequest, format: String },

  sentence: ({ perPullRequest, pullRequests }) =>
    `${String(perPullRequest)} CI fix cycles per pull request on average, over ${String(pullRequests)} pull requests`,

  section({ perPullRequest, total, pullRequests, withFixCycles }) {
    const summary = `<p><strong>${String(perPullRequest)}</strong> fix cycles per PR: ${String(total)} over ${String(pullRequests)} PRs with a CI run.</p>`;
    if (!withFixCycles?.length) return summary;
    const rows = withFixCycles.map((row) => `<tr><td>PR #${String(row.pullRequest)}</td><td>${String(row.fixCycles)}</td></tr>`).join("");
    return `${summary}<table><thead><tr><th>PR</th><th>Fix cycles</th></tr></thead><tbody>${rows}</tbody></table>`;
  },

  methodology: {
    definition:
      "Pushes to a PR's branch that followed a failed CI run or a review requesting changes on that PR, averaged over PRs with a CI run. A PR's pushes are the head commits its <code>pull_request</code> runs (any workflow) ran on, in order, each timed by its first run's creation. A push counts when a run on the previous head failed (first or latest attempt), or a changes-requested review was submitted between the previous push and this one. Re-running a run is not a push.",
    limits:
      "Only pushes that triggered CI are seen, and several commits pushed at once count as one push. Commit dates are not used, since authors control them. A PR with no CI run is left out. The first push, which opens the PR, is never a fix cycle.",
  },
};
