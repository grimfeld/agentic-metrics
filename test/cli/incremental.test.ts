import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource, type GitHubRequest, type GitHubSource } from "../../cli/github/source.ts";

// Two recordings of the same repo, a week apart. Before (2026-10-26): PRs #10
// (closes #1) and #11 (closes nothing) merged, issue #2 open. After
// (2026-11-02): issue #2 got the ready label and PR #12 closed it; issue #3
// was opened and closed. #1, #10 and #11 did not change.
const HISTORY = join(import.meta.dirname, "../fixtures/github/history");
const BEFORE = new Date("2026-10-26T00:00:00Z");
const AFTER = new Date("2026-11-02T00:00:00Z");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "am-incremental-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A fixture source that records the PR and issue numbers each read returned. */
function recording(fixture: string) {
  const inner = fixtureSource(join(HISTORY, fixture));
  const fetched: Partial<Record<GitHubRequest, number[]>> = {};
  const source: GitHubSource = {
    async read(request, options) {
      const raw = await inner.read(request, options);
      if (request === "pull-requests" || request === "issues") {
        const connection = request === "issues" ? "issues" : "pullRequests";
        fetched[request] = (raw as { data: { repository: Record<string, { nodes: { number: number }[] }> } }[])
          .flatMap((page) => page.data.repository[connection]?.nodes ?? [])
          .map((node) => node.number)
          .sort((a, b) => a - b);
      }
      return raw;
    },
  };
  return { source, fetched };
}

async function collect(cwd: string, source: GitHubSource, now: Date, args: string[] = []) {
  const status = await main(["collect", ...args], {
    cwd,
    github: source,
    cacheDir: join(cwd, "cache"),
    now: () => now,
    stdout: () => undefined,
  });
  assert.equal(status, 0);
  return readFileSync(join(cwd, "datasets/grimfeld/history.json"), "utf8");
}

describe("collect, incremental", () => {
  it("backfills every merged PR and issue on the first run", async () => {
    const { source, fetched } = recording("after");
    await collect(dir, source, AFTER);

    assert.deepEqual(fetched, { "pull-requests": [10, 11, 12], issues: [1, 2, 3] });
  });

  it("fetches only what changed since the last run", async () => {
    await collect(dir, recording("before").source, BEFORE);
    const { source, fetched } = recording("after");
    await collect(dir, source, AFTER);

    assert.deepEqual(fetched, { "pull-requests": [12], issues: [2, 3] });
  });

  it("yields the same dataset as a full re-collection", async () => {
    await collect(dir, recording("before").source, BEFORE);
    const incremental = await collect(dir, recording("after").source, AFTER);

    const fresh = mkdtempSync(join(tmpdir(), "am-full-"));
    try {
      const full = await collect(fresh, recording("after").source, AFTER);
      assert.equal(incremental, full);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
    // Lead times: #1 24 h, PR #11 30 h, #2 36 h (from its ready label, added after the first run).
    const dataset = JSON.parse(incremental) as { tickets: number; metrics: Record<string, unknown> };
    assert.equal(dataset.tickets, 3);
    assert.deepEqual(dataset.metrics["leadTime"], { value: { p50Hours: 30, p90Hours: 36 }, coverage: { tickets: 3, of: 3 } });
  });

  // Runs are read on their creation time. Before: nightly run 2 (created
  // 2026-10-25T20:00) still running. After: it failed, and run 3 passed.
  it("reads workflow runs created since the last run, and again a run that was still in progress", async () => {
    await collect(dir, recording("before").source, BEFORE);
    const fetched: number[] = [];
    const inner = fixtureSource(join(HISTORY, "after"));
    const source: GitHubSource = {
      async read(request, options) {
        const raw = await inner.read(request, options);
        if (request === "workflow-runs") {
          fetched.push(...(raw as { workflow_runs: { id: number }[] }[]).flatMap((page) => page.workflow_runs.map((run) => run.id)));
        }
        return raw;
      },
    };
    const dataset = JSON.parse(await collect(dir, source, AFTER)) as { metrics: Record<string, { value: unknown }> };

    assert.deepEqual(fetched.sort(), [41000000002, 41000000003]);
    assert.deepEqual(dataset.metrics["scheduledFailures"]?.value, {
      failed: 1,
      runs: 3,
      workflows: [{ workflow: ".github/workflows/e2e.yml", failed: 1, runs: 3 }],
    });
  });

  it("re-collects everything with --full", async () => {
    await collect(dir, recording("before").source, BEFORE);
    const { source, fetched } = recording("after");
    await collect(dir, source, AFTER, ["--full"]);

    assert.deepEqual(fetched, { "pull-requests": [10, 11, 12], issues: [1, 2, 3] });
  });

  it("keeps one cache per repo", async () => {
    await collect(dir, recording("before").source, BEFORE);
    const status = await main(["collect"], {
      cwd: dir,
      github: fixtureSource(join(import.meta.dirname, "../fixtures/github/empty")),
      cacheDir: join(dir, "cache"),
      now: () => AFTER,
      stdout: () => undefined,
    });
    assert.equal(status, 0);
    const { source, fetched } = recording("after");
    await collect(dir, source, AFTER);

    assert.deepEqual(fetched, { "pull-requests": [12], issues: [2, 3] });
  });
});
