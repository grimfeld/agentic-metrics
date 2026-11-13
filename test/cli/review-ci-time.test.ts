// Review wait, rounds of review, and CI duration.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Ci } from "../../cli/ci.ts";
import { loadGitHub, type PullRequest, type WorkflowRun } from "../../cli/github/load.ts";
import type { GitHubRequest } from "../../cli/github/source.ts";
import type { LinkedWork, Ticket } from "../../cli/linker.ts";
import { ciDuration } from "../../cli/metrics/ci-duration.ts";
import { reviewRounds, reviewWait } from "../../cli/metrics/review-wait.ts";

const at = (hour: number) => new Date(Date.UTC(2026, 9, 1, hour));
const review = (hour: number, state: string, byBot = false) => ({ at: at(hour), state, byBot });

function pr(number: number, extra: Partial<PullRequest> = {}): PullRequest {
  return { number, createdAt: at(0), mergedAt: at(40), headRefName: `b${String(number)}`, reviews: [], ...extra } as unknown as PullRequest;
}

const run = (sha: string, hour: number, minutes?: number): WorkflowRun =>
  ({ id: hour, path: "check.yml", event: "pull_request", headBranch: "b1", headSha: sha, createdAt: at(hour), firstAttemptMs: minutes === undefined ? undefined : minutes * 60_000 }) as WorkflowRun;

function work(prs: PullRequest[], runs: WorkflowRun[] = []): LinkedWork {
  const tickets = prs.map((p) => ({ id: `PR #${String(p.number)}`, pullRequests: [p] }) as unknown as Ticket);
  const ci: Ci = { defaultBranch: "main", mainWorkflow: "check.yml", runs: [...runs].reverse() };
  return { tickets, ci } as unknown as LinkedWork;
}

describe("review wait", () => {
  it("starts a draft PR's wait when it was marked ready, and skips bots' reviews", () => {
    const draft = pr(1, { readyForReviewAt: at(10), reviews: [review(5, "COMMENTED"), review(11, "COMMENTED", true), review(13, "APPROVED")] });
    const value = reviewWait.compute(work([draft])).value;
    assert.notEqual(value, "unknown");
    if (value === "unknown") return;

    assert.deepEqual(value.perPullRequest, [{ pullRequest: 1, hours: 3, rounds: 1 }]);
  });

  it("is unknown, not zero, for a PR never reviewed", () => {
    assert.equal(reviewWait.compute(work([pr(1)])).value, "unknown");
    const value = reviewWait.compute(work([pr(1), pr(2, { reviews: [review(2, "APPROVED")] })])).value;
    assert.ok(value !== "unknown");
    assert.equal(value.unreviewed, 1);
    assert.equal(value.reviewed, 1);
  });

  it("counts a round per stretch between pushes that holds a review asking for changes", () => {
    const reviewed = pr(1, { reviews: [review(2, "CHANGES_REQUESTED"), review(3, "COMMENTED"), review(6, "CHANGES_REQUESTED"), review(9, "APPROVED")] });
    const runs = [run("a", 1), run("a", 1), run("b", 5), run("c", 8)];

    assert.equal(reviewRounds(reviewed, work([reviewed], runs).ci), 2);
  });
});

describe("CI duration", () => {
  it("adds up the main workflow's first attempts per PR", () => {
    const value = ciDuration.compute(work([pr(1)], [run("a", 1, 4), run("b", 5, 6), run("c", 6)])).value;
    assert.ok(value !== "unknown");

    assert.deepEqual(value.perPullRequest, [{ pullRequest: 1, runs: 2, minutes: 10 }]);
    assert.equal(value.p50Minutes, 4);
  });

  it("times a re-run by its first attempt, not its latest", async () => {
    const empty = (key: string) => [{ data: { repository: { [key]: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } }];
    const answers: Record<GitHubRequest, unknown> = {
      repo: { full_name: "o/r", default_branch: "main", private: false, html_url: "" },
      "pull-requests": empty("pullRequests"),
      "closed-pull-requests": empty("pullRequests"),
      issues: empty("issues"),
      regressions: empty("issues"),
      "workflow-runs": [
        {
          total_count: 1,
          workflow_runs: [
            {
              id: 1, name: "Check", path: "check.yml", event: "pull_request", head_branch: "b", head_sha: "a", status: "completed", conclusion: "success",
              created_at: "2026-10-01T00:00:00Z", run_attempt: 2, run_started_at: "2026-10-01T05:00:00Z", updated_at: "2026-10-01T05:30:00Z",
              first_attempt: { status: "completed", conclusion: "failure", run_started_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:10:00Z" },
            },
          ],
        },
      ],
    };
    const data = await loadGitHub({ read: (request) => Promise.resolve(answers[request]) });

    assert.equal(data.workflowRuns[0]?.firstAttemptMs, 10 * 60_000);
  });
});
