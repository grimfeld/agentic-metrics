// CI runs as the metrics see them: which workflow is the repo's main check,
// which runs belong to a PR, and what a run's first result was.
//
// The runs listing's `pull_requests` field is often empty, so a PR's runs are
// joined on its head branch instead: `pull_request` runs on that branch created
// between the PR's opening and its merge (a branch name can be reused by a
// later PR, and push runs before the PR opened are not the PR's).
import { basename } from "node:path";
import type { PullRequest, WorkflowRun } from "./github/load.ts";

export interface Ci {
  defaultBranch: string;
  /** The main check workflow's path; undefined when no run matches the config, or no PR has a run. */
  mainWorkflow: string | undefined;
  /** Every run but GitHub's own `dynamic` ones, newest first. */
  runs: WorkflowRun[];
}

/** A conclusion that is a result: passed, failed, or neither (cancelled, skipped, still running…). */
export function verdict(conclusion: string | undefined): "passed" | "failed" | undefined {
  if (conclusion === "success") return "passed";
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "startup_failure") return "failed";
  return undefined;
}

/** A PR's `pull_request` runs, of every workflow, oldest first. */
export function pullRequestRuns(pr: PullRequest, ci: Ci): WorkflowRun[] {
  return ci.runs
    .filter(
      (run) =>
        run.event === "pull_request" && run.headBranch === pr.headRefName && run.createdAt >= pr.createdAt && run.createdAt <= pr.mergedAt,
    )
    .reverse();
}

/**
 * The first CI result of a PR: the first attempt of the first run of the main
 * check workflow that gave a result. A run cancelled or skipped gave none, and
 * the next one counts. Undefined when no run gave a result.
 */
export function firstResult(pr: PullRequest, ci: Ci): "passed" | "failed" | undefined {
  for (const run of pullRequestRuns(pr, ci)) {
    if (run.path !== ci.mainWorkflow) continue;
    const result = verdict(run.firstAttemptConclusion);
    if (result) return result;
  }
  return undefined;
}

/**
 * The main check workflow: the configured one, matched on path, file name or
 * name; else the workflow that ran on the most of these PRs (ties: by path).
 */
export function mainWorkflow(runs: WorkflowRun[], pullRequests: PullRequest[], configured: string | undefined): string | undefined {
  if (configured !== undefined) {
    return runs.find((run) => run.path === configured || basename(run.path) === configured || run.name === configured)?.path;
  }
  const prsPerWorkflow = new Map<string, number>();
  const ci: Ci = { defaultBranch: "", mainWorkflow: undefined, runs };
  for (const pr of pullRequests) {
    for (const path of new Set(pullRequestRuns(pr, ci).map((run) => run.path))) {
      prsPerWorkflow.set(path, (prsPerWorkflow.get(path) ?? 0) + 1);
    }
  }
  return [...prsPerWorkflow.entries()].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))[0]?.[0];
}
