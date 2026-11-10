import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";

const FIXTURES = join(import.meta.dirname, "../fixtures/github");
const NOW = new Date("2026-11-09T12:00:00Z");

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-collect-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

async function collect(fixture: string, args: string[] = []) {
  const status = await main(["collect", ...args], { cwd, github: fixtureSource(join(FIXTURES, fixture)), now: () => NOW });
  assert.equal(status, 0);
}

function dataset(path = "datasets/grimfeld/lifeline.json") {
  return JSON.parse(readFileSync(join(cwd, path), "utf8")) as {
    repo: string;
    generatedAt: string;
    metrics: Record<string, { value: unknown; coverage: { tickets: number; of: number } }>;
  };
}

describe("collect", () => {
  it("writes the repo's dataset under datasets/<owner>/<repo>.json", async () => {
    await collect("lifeline");

    const data = dataset();
    assert.equal(data.repo, "grimfeld/lifeline");
    assert.equal(data.generatedAt, "2026-11-09T12:00:00.000Z");
  });

  // Fixture tickets: #104 and #105 (both closed by PR #115), #106 (PRs #116 and
  // #117), PR #136 (closes nothing), PR #137 (closes only another repo's issue).
  // PR #42 targets a feature branch, so it and its issue #107 are not delivered.
  it("counts tickets and PRs per week (weeks start on Monday, empty weeks included)", async () => {
    await collect("lifeline");

    assert.deepEqual(dataset().metrics["throughput"], {
      value: {
        weeks: [
          { week: "2026-10-19", tickets: 2, pullRequests: 2 },
          { week: "2026-10-26", tickets: 2, pullRequests: 2 },
          { week: "2026-11-02", tickets: 0, pullRequests: 0 },
          { week: "2026-11-09", tickets: 1, pullRequests: 1 },
        ],
      },
      coverage: { tickets: 5, of: 5 },
    });
  });

  // Lead times, in hours: PR #136 6, PR #137 10, #104 12 (ready label),
  // #105 20 (never labelled: from creation), #106 180 (ready label, after an
  // unrelated `bug` label, to its second PR). Nearest rank: p50 12, p90 180.
  it("measures lead time from the ready label, else creation, to the last PR merged", async () => {
    await collect("lifeline");

    assert.deepEqual(dataset().metrics["leadTime"], {
      value: {
        p50Hours: 12,
        p90Hours: 180,
        // Where it went, over the 5 tickets' 228 h: 21 h of queue, 169 h of work, 38 h of landing wait.
        phases: {
          tickets: 5,
          queue: { p50Hours: 1, share: 0.092 },
          work: { p50Hours: 0.5, share: 0.741 },
          landing: { p50Hours: 9, share: 0.167 },
        },
        // Per ticket, in delivery order: traceable in a `full` dataset. Its phases
        // add up to its lead time: ready to first commit, to last commit, to merged.
        tickets: [
          { ticket: "#104", hours: 12, queueHours: 1, workHours: 0.5, landingHours: 10.5 },
          { ticket: "#105", hours: 20, queueHours: 9, workHours: 0.5, landingHours: 10.5 },
          { ticket: "PR #136", hours: 6, queueHours: 1, workHours: 0, landingHours: 5 },
          // Its two PRs' commits are a week apart: the work phase holds that idle.
          { ticket: "#106", hours: 180, queueHours: 9, workHours: 168, landingHours: 3 },
          { ticket: "PR #137", hours: 10, queueHours: 1, workHours: 0, landingHours: 9 },
        ],
      },
      coverage: { tickets: 5, of: 5 },
    });
  });

  it("starts lead time at the ready label named in the repo's config", async () => {
    // With `bug` as the ready label, #106 starts 12 h earlier (192 h) and #104,
    // never labelled `bug`, starts at its creation (24 h).
    writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify({ readyLabel: "bug" }));
    await collect("lifeline");

    const { p50Hours, p90Hours } = dataset().metrics["leadTime"]?.value as { p50Hours: number; p90Hours: number };
    assert.deepEqual({ p50Hours, p90Hours }, { p50Hours: 20, p90Hours: 192 });
  });

  it("reads another repo's config from its checkout", async () => {
    mkdirSync(join(cwd, "clone"));
    writeFileSync(join(cwd, "clone", ".agentic-metrics.json"), JSON.stringify({ readyLabel: "bug" }));
    await collect("lifeline", ["--repo", "grimfeld/lifeline", "--checkout", "clone"]);

    // As with `bug` as the ready label in the current folder (see above).
    const { p50Hours, p90Hours } = dataset().metrics["leadTime"]?.value as { p50Hours: number; p90Hours: number };
    assert.deepEqual({ p50Hours, p90Hours }, { p50Hours: 20, p90Hours: 192 });
  });

  it("warns that another repo without --checkout gets this folder's config and no transcripts", async () => {
    let stderr = "";
    const status = await main(["collect", "--repo", "grimfeld/lifeline"], {
      cwd,
      github: fixtureSource(join(FIXTURES, "lifeline")),
      now: () => NOW,
      stdout: () => undefined,
      stderr: (text) => (stderr += text),
    });

    assert.equal(status, 0, stderr);
    assert.match(stderr, /grimfeld\/lifeline.*--checkout/s);
    assert.match(stderr, /transcript/);
  });

  it("reports lead time as unknown, not zero, when no ticket was delivered", async () => {
    await collect("empty");

    assert.deepEqual(dataset("datasets/grimfeld/agentic-metrics.json").metrics["leadTime"], {
      value: "unknown",
      coverage: { tickets: 0, of: 0 },
    });
  });

  it("reports throughput as unknown, not zero, when nothing was merged", async () => {
    await collect("empty");

    assert.deepEqual(dataset("datasets/grimfeld/agentic-metrics.json").metrics["throughput"], {
      value: "unknown",
      coverage: { tickets: 0, of: 0 },
    });
  });
});
