// How long regressions took to be found and fixed, and PRs cut off by GitHub's limits.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findGaps } from "../../cli/gaps.ts";
import type { GitHubData, PullRequest, RegressionIssue } from "../../cli/github/load.ts";
import type { InferredRegression } from "../../cli/inferred-regressions.ts";
import type { LinkedWork, Ticket } from "../../cli/linker.ts";
import { regressionTiming } from "../../cli/metrics/regression-timing.ts";
import { readConfig } from "../../cli/config.ts";
import { tmpdir } from "node:os";

const day = (n: number) => new Date(Date.UTC(2026, 9, n));

const ticket = (id: string, done: number, prs: Partial<PullRequest>[] = []) => ({ id, doneAt: day(done), sessions: [], batchCommits: [], pullRequests: prs.map((pr, index) => ({ number: 100 + index, filesComplete: true, commits: [], ...pr })) }) as unknown as Ticket;

function work(tickets: Ticket[], regressions: RegressionIssue[], inferredRegressions: InferredRegression[] = []): LinkedWork {
  return { tickets, regressions, inferredRegressions, transcripts: { sessions: 0, orchestration: [] }, ci: { mainWorkflow: "check.yml" } } as unknown as LinkedWork;
}

describe("regression timing", () => {
  it("gives an open regression a found time and no fix time", () => {
    const value = regressionTiming.compute(work([ticket("#1", 1)], [{ number: 9, causedBy: [1], fixed: false, createdAt: day(3), closedAt: undefined }])).value;
    assert.ok(value !== "unknown");

    assert.deepEqual(value.declared, { found: { p50Hours: 48, p90Hours: 48, regressions: 1 }, open: 1 });
    assert.deepEqual(value.perRegression, [{ ticket: "#1", kind: "declared", foundHours: 48 }]);
  });

  it("times a fixed one from opening to closing, and keeps inferred ones apart", () => {
    const cause = ticket("#1", 1);
    const by = { createdAt: day(5), mergedAt: day(6) } as PullRequest;
    const value = regressionTiming.compute(
      work([cause], [{ number: 9, causedBy: [1], fixed: true, createdAt: day(2), closedAt: day(4) }], [{ cause, how: "revert", by, at: day(6) }]),
    ).value;
    assert.ok(value !== "unknown");

    assert.deepEqual(value.declared.fixed, { p50Hours: 48, p90Hours: 48, regressions: 1 });
    assert.deepEqual(value.inferred, { found: { p50Hours: 96, p90Hours: 96, regressions: 1 }, fixed: { p50Hours: 24, p90Hours: 24, regressions: 1 }, open: 0 });
  });
});

describe("truncated PRs", () => {
  it("counts a PR with more than 100 commits or files in a gap", () => {
    const tickets = [ticket("#1", 1, [{ commitsComplete: false }]), ticket("#2", 1, [{ filesComplete: false }]), ticket("#3", 1, [{}])];
    const data = { actionRuns: [{ createdAt: day(1), conclusion: "success" }], regressions: [{}] } as unknown as GitHubData;
    const gap = findGaps({ work: work(tickets, []), data, config: readConfig(tmpdir()), checkout: undefined }).find((g) => g.id === "truncated-prs");

    assert.deepEqual(gap?.ticketIds, ["#1", "#2"]);
  });
});
