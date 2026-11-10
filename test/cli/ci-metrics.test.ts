import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { main } from "../../cli/main.ts";
import { readMetricPages, readRepo } from "./report-pages.ts";
import { fixtureSource } from "../../cli/github/source.ts";

const FIXTURES = join(import.meta.dirname, "../fixtures/github");
const NOW = new Date("2026-11-09T12:00:00Z");

// The `ci` fixture (grimfeld/ci, default branch master), main check "Check",
// with "Dependency review" running beside it on every PR push:
// - #201: its first run passes.
// - #202: its first run fails; the next push passes, and one more push follows.
//   A push-event run before the PR opened does not count.
// - #203: its only run was re-run: attempt 1 failed, attempt 2 passed.
// - #204: its first run was cancelled, the next one passed; a review then
//   requested changes, and a push followed.
// - #205: no CI run at all.
// - #206, #207, #208: ticket PRs landed by batches, with no CI of their own.
// - Integration PR #210 lists #206, #207 and, as skipped, #208; it was red on
//   its first run. Integration PR #211 lands #208, green on its first run.
// - Nightly E2E on master: 4 runs, 2 of them failed on their first attempt.
// 8 tickets in all (#301 to #308).
let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-ci-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

interface Result {
  value: unknown;
  coverage: { tickets: number; of: number };
}

async function collect(fixture = "ci", config?: Record<string, unknown>): Promise<Record<string, Result | undefined>> {
  if (config) writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify(config));
  let stderr = "";
  const status = await main(["collect"], {
    cwd,
    github: fixtureSource(resolve(FIXTURES, fixture)),
    now: () => NOW,
    stdout: () => undefined,
    stderr: (text) => (stderr += text),
  });
  assert.equal(status, 0, stderr);
  const repo = JSON.parse(readFileSync(resolve(FIXTURES, fixture, "repo.json"), "utf8")) as { full_name: string };
  const alias = config?.["alias"];
  const path = typeof alias === "string" && config?.["publish"] === "anonymized" ? `${alias}.json` : `${repo.full_name}.json`;
  const dataset = JSON.parse(readFileSync(join(cwd, "datasets", path), "utf8")) as { metrics: Record<string, Result> };
  return dataset.metrics;
}

describe("first-run CI rate", () => {
  it("is the share of PRs whose main check passed on the first attempt of its first run", async () => {
    const { firstRunCiRate } = await collect();
    // Passed: #201, #204 (its cancelled run gave no result). Failed: #202, #203 (re-run).
    assert.deepEqual(firstRunCiRate, {
      value: {
        rate: 0.5,
        passed: 2,
        pullRequests: 4,
        workflow: ".github/workflows/check.yml",
        perPullRequest: [
          { pullRequest: 201, firstRun: "passed" },
          { pullRequest: 202, firstRun: "failed" },
          { pullRequest: 203, firstRun: "failed" },
          { pullRequest: 204, firstRun: "passed" },
        ],
      },
      coverage: { tickets: 4, of: 8 },
    });
  });

  it("judges the workflow the config names as the main check", async () => {
    const { firstRunCiRate } = await collect("ci", { ciWorkflow: "Dependency review" });
    assert.deepEqual(firstRunCiRate?.value, {
      rate: 1,
      passed: 4,
      pullRequests: 4,
      workflow: ".github/workflows/dependency-review.yml",
      perPullRequest: [201, 202, 203, 204].map((pullRequest) => ({ pullRequest, firstRun: "passed" })),
    });
  });

  it("is unknown, not zero, when no PR has a CI run", async () => {
    const { firstRunCiRate } = await collect("lifeline");
    assert.deepEqual(firstRunCiRate, { value: "unknown", coverage: { tickets: 0, of: 5 } });
  });
});

describe("fix cycles", () => {
  // #202: the push after its failed run is one; the push after a green run is not.
  // #203: a re-run is no push. #204: the push after changes were requested is one.
  it("counts pushes to a PR after a failed CI run or a changes-requested review", async () => {
    const { fixCycles } = await collect();
    assert.deepEqual(fixCycles, {
      value: {
        perPullRequest: 0.5,
        total: 2,
        pullRequests: 4,
        withFixCycles: [
          { pullRequest: 202, fixCycles: 1 },
          { pullRequest: 204, fixCycles: 1 },
        ],
      },
      coverage: { tickets: 4, of: 8 },
    });
  });

  it("is unknown, not zero, when no PR has a CI run", async () => {
    const { fixCycles } = await collect("lifeline");
    assert.deepEqual(fixCycles, { value: "unknown", coverage: { tickets: 0, of: 5 } });
  });
});

describe("the installed agentic-metrics workflow", () => {
  /** The `ci` fixture plus a failed run of `agentic-metrics.yml` beside every PR run of the main check. */
  function withConventionsRuns(): string {
    const dir = mkdtempSync(join(tmpdir(), "am-ci-fixture-"));
    cpSync(join(FIXTURES, "ci"), dir, { recursive: true });
    const pages = JSON.parse(readFileSync(join(dir, "workflow-runs.json"), "utf8")) as { workflow_runs: Record<string, unknown>[] }[];
    for (const page of pages) {
      const extra = page.workflow_runs
        .filter((run) => run["event"] === "pull_request" && run["path"] === ".github/workflows/check.yml")
        .map((run) => ({ ...run, id: Number(run["id"]) + 1000, name: "agentic-metrics", path: ".github/workflows/agentic-metrics.yml", conclusion: "failure", run_attempt: 1 }));
      page.workflow_runs.push(...extra);
    }
    writeFileSync(join(dir, "workflow-runs.json"), JSON.stringify(pages));
    return dir;
  }

  it("is never taken for the main check, nor its failures for fix cycles", async () => {
    const fixture = withConventionsRuns();
    try {
      const { firstRunCiRate, fixCycles } = await collect(fixture);
      assert.equal((firstRunCiRate?.value as { workflow: string }).workflow, ".github/workflows/check.yml");
      assert.equal((fixCycles?.value as { total: number }).total, 2);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

describe("scheduled failures", () => {
  // The run failed on 2026-10-03 passed on a re-run, but its first attempt failed.
  // CodeQL's dynamic "Scheduled" failure is not CI.
  it("counts failed scheduled runs on the default branch, at repo level", async () => {
    const { scheduledFailures } = await collect();
    assert.deepEqual(scheduledFailures, {
      value: { failed: 2, runs: 4, workflows: [{ workflow: ".github/workflows/e2e.yml", failed: 2, runs: 4 }] },
      coverage: { tickets: 8, of: 8 },
    });
  });

  it("is unknown, not zero, when the repo has no scheduled run", async () => {
    const { scheduledFailures } = await collect("lifeline");
    assert.equal(scheduledFailures?.value, "unknown");
  });
});

describe("batch health", () => {
  // #210 lists #208 as skipped: #208 merged a day later, with #211.
  it("reports integration PRs green on their first CI run and PRs dropped from batches", async () => {
    const { batchHealth } = await collect();
    assert.deepEqual(batchHealth, {
      value: {
        batches: 2,
        withCi: 2,
        greenOnFirstRun: 1,
        greenRate: 0.5,
        dropped: 1,
        perBatch: [
          { pullRequest: 210, firstRun: "failed", dropped: [208] },
          { pullRequest: 211, firstRun: "passed", dropped: [] },
        ],
      },
      coverage: { tickets: 8, of: 8 },
    });
  });

  it("is unknown, not zero, when no integration PR was merged", async () => {
    const { batchHealth } = await collect("lifeline");
    assert.equal(batchHealth?.value, "unknown");
  });
});

const CI_METRICS = ["firstRunCiRate", "fixCycles", "scheduledFailures", "batchHealth"];

describe("CI metrics, anonymized", () => {
  it("keep aggregates and name no PR", async () => {
    const metrics = await collect("ci", { publish: "anonymized", alias: "client-a" });
    for (const id of CI_METRICS) {
      const text = JSON.stringify(metrics[id]);
      assert.doesNotMatch(text, /pullRequest"|perBatch|withFixCycles|\b20\d\b/, `${id} leaks a PR: ${text}`);
      assert.doesNotMatch(text, /workflows?"|\.ya?ml|\.github/i, `${id} leaks a workflow: ${text}`);
    }
    assert.equal((metrics["firstRunCiRate"]?.value as { rate: number }).rate, 0.5);
    assert.deepEqual(metrics["fixCycles"]?.value, { perPullRequest: 0.5, total: 2, pullRequests: 4 });
    assert.deepEqual(metrics["batchHealth"]?.value, { batches: 2, withCi: 2, greenOnFirstRun: 1, greenRate: 0.5, dropped: 1 });
  });
});

describe("CI metrics in the report", () => {
  async function report(): Promise<string> {
    await collect();
    const status = await main(["report"], { cwd, stdout: () => undefined, stderr: () => undefined });
    assert.equal(status, 0);
    const site = join(cwd, "report");
    return `${readRepo(site, "grimfeld/ci")}\n${readMetricPages(site, "grimfeld/ci", CI_METRICS)}`;
  }

  it("fills the first-run CI rate headline tile", async () => {
    const html = await report();
    const card = /<a class="tile[^"]*" href="[^"]*" data-metric="firstRunCiRate">.*?<\/a>/s.exec(html)?.[0] ?? "";
    assert.match(card, /50%/);
    assert.match(card, /4 of 8 tickets/);
  });

  it("shows each CI metric with its Methodology entry and coverage", async () => {
    const html = await report();
    for (const id of ["fixCycles", "scheduledFailures", "batchHealth"]) assert.match(html, new RegExp(`data-section="${id}"`));
    for (const id of CI_METRICS) {
      const entry = new RegExp(`<article [^>]*data-methodology="${id}">.*?</article>`, "s").exec(html)?.[0] ?? "";
      assert.match(entry, /Coverage:<\/strong> grimfeld\/ci \d+ of 8 tickets/, id);
    }
    assert.match(html, /<article [^>]*data-methodology="firstRunCiRate">.*re-run.*<\/article>/s);
  });
});
