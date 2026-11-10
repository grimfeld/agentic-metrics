import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";

const FIXTURES = join(import.meta.dirname, "../fixtures/github");
const NOW = new Date("2026-11-09T12:00:00Z");

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-diff-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

async function metric(id: string, fixture = "lifeline", repo = "grimfeld/lifeline") {
  const status = await main(["collect"], { cwd, github: fixtureSource(join(FIXTURES, fixture)), now: () => NOW });
  assert.equal(status, 0);
  const dataset = JSON.parse(readFileSync(join(cwd, `datasets/${repo}.json`), "utf8")) as {
    metrics: Record<string, unknown>;
  };
  return dataset.metrics[id];
}

// Delivered PRs in the lifeline fixture, as +additions/-deletions:
// #115 +120/-30 (#104, #105), #116 +50/-70 and #117 +10/-40 (#106),
// #136 +200/-5 (its own ticket), #137 +5/-0 (its own ticket).
// PR #42 (+999/-1) targets a feature branch and is not delivered.
describe("diff metrics", () => {
  it("reports net lines removed over the PRs delivered, each PR counted once", async () => {
    assert.deepEqual(await metric("netLinesRemoved"), {
      value: {
        linesAdded: 385,
        linesDeleted: 145,
        netLinesRemoved: -240,
        ticketsNetRemoving: 1,
        // Per ticket over its own PRs: #104 and #105 share #115.
        tickets: [
          { ticket: "#104", linesAdded: 120, linesDeleted: 30 },
          { ticket: "#105", linesAdded: 120, linesDeleted: 30 },
          { ticket: "PR #136", linesAdded: 200, linesDeleted: 5 },
          { ticket: "#106", linesAdded: 60, linesDeleted: 110 },
          { ticket: "PR #137", linesAdded: 5, linesDeleted: 0 },
        ],
      },
      coverage: { tickets: 5, of: 5 },
    });
  });

  // Lines added per file: #115 src/house.ts 80, src/house.test.ts 30,
  // package-lock.json 10 (neither); #116 src/editor.ts 20, test/editor.spec.ts 30;
  // #117 src/editor.ts 10, README.md 0 (neither); #137 ui/__tests__/kit.test.tsx 5.
  // #136 lists 2 of its 101 files, so its ticket is left out.
  it("classifies lines added as test or production and reports their ratio", async () => {
    assert.deepEqual(await metric("testRatio"), {
      value: {
        testLinesAdded: 65,
        productionLinesAdded: 110,
        ratio: 0.59,
        tickets: [
          { ticket: "#104", testLinesAdded: 30, productionLinesAdded: 80 },
          { ticket: "#105", testLinesAdded: 30, productionLinesAdded: 80 },
          { ticket: "#106", testLinesAdded: 30, productionLinesAdded: 30 },
          { ticket: "PR #137", testLinesAdded: 5, productionLinesAdded: 0 },
        ],
      },
      coverage: { tickets: 4, of: 5 },
    });
  });

  it("reports the test ratio as unknown when nothing was delivered", async () => {
    assert.deepEqual(await metric("testRatio", "empty", "grimfeld/agentic-metrics"), {
      value: "unknown",
      coverage: { tickets: 0, of: 0 },
    });
  });

  // Diff size is lines added plus deleted. #106's two PRs both touch
  // src/editor.ts, counted once. #136 lists 2 of its files; GitHub's count
  // (101) stands. #104 has two sub-issues; a PR ticket has none.
  it("gives each ticket its diff size, files touched and sub-tickets", async () => {
    assert.deepEqual(await metric("size"), {
      value: {
        p50DiffLines: 150,
        p50FilesTouched: 3,
        tickets: [
          { ticket: "#104", diffLines: 150, filesTouched: 3, subTickets: 2 },
          { ticket: "#105", diffLines: 150, filesTouched: 3, subTickets: 0 },
          { ticket: "PR #136", diffLines: 205, filesTouched: 101, subTickets: 0 },
          { ticket: "#106", diffLines: 170, filesTouched: 3, subTickets: 0 },
          { ticket: "PR #137", diffLines: 5, filesTouched: 1, subTickets: 0 },
        ],
      },
      coverage: { tickets: 5, of: 5 },
    });
  });

  // #104: `estimate: 4h` at 08:30, before PR #115's first commit (09:00); a
  // later `estimate: 1d` is ignored. #105: a bot's `estimate: 1w` and an
  // `estimate:` mid-sentence are skipped; `Estimate: 1.5d` counts, as 12 h of
  // work (a day is 8 h). The actual is their active time: with no transcript,
  // the 30 minutes between PR #115's two commits, not the 11 h to its merge.
  // #106's estimate came after PR #116's first commit, so it is left out.
  it("compares the earliest estimate with the ticket's active time, when it predates the first commit", async () => {
    assert.deepEqual(await metric("estimateVsActual"), {
      value: {
        p50Ratio: 0.04,
        excludedLate: 1,
        excludedUnknownActual: 0,
        tickets: [
          { ticket: "#104", estimateHours: 4, actualHours: 0.5, actual: "estimated", ratio: 0.13, diffLines: 150, filesTouched: 3, subTickets: 2 },
          { ticket: "#105", estimateHours: 12, actualHours: 0.5, actual: "estimated", ratio: 0.04, diffLines: 150, filesTouched: 3, subTickets: 0 },
        ],
      },
      coverage: { tickets: 2, of: 5 },
    });
  });

  it("reports estimate vs actual as unknown when no ticket has an estimate", async () => {
    assert.deepEqual(await metric("estimateVsActual", "empty", "grimfeld/agentic-metrics"), {
      value: "unknown",
      coverage: { tickets: 0, of: 0 },
    });
  });

  it("reports net lines removed as unknown when nothing was delivered", async () => {
    assert.deepEqual(await metric("netLinesRemoved", "empty", "grimfeld/agentic-metrics"), {
      value: "unknown",
      coverage: { tickets: 0, of: 0 },
    });
  });
});
