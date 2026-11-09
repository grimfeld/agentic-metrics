import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      value: { p50Hours: 12, p90Hours: 180 },
      coverage: { tickets: 5, of: 5 },
    });
  });

  it("starts lead time at the ready label named in the repo's config", async () => {
    // With `bug` as the ready label, #106 starts 12 h earlier (192 h) and #104,
    // never labelled `bug`, starts at its creation (24 h).
    writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify({ readyLabel: "bug" }));
    await collect("lifeline");

    assert.deepEqual(dataset().metrics["leadTime"], {
      value: { p50Hours: 20, p90Hours: 192 },
      coverage: { tickets: 5, of: 5 },
    });
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
