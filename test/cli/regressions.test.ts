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
  cwd = mkdtempSync(join(tmpdir(), "am-regressions-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

interface Regressions {
  rate: number;
  regressions: number;
  regressedTickets: number;
  untraced: number[];
  perTicket: { ticket: string; bugs: number[] }[];
}

async function regressionRate(fixture = "lifeline", path = "datasets/grimfeld/lifeline.json") {
  const status = await main(["collect"], { cwd, github: fixtureSource(join(FIXTURES, fixture)), now: () => NOW, stdout: () => undefined });
  assert.equal(status, 0);
  const dataset = JSON.parse(readFileSync(join(cwd, path), "utf8")) as {
    metrics: Record<string, { value: Regressions | "unknown"; coverage: { tickets: number; of: number } }>;
  };
  const result = dataset.metrics["regressionRate"];
  assert.ok(result, "no regressionRate in the dataset");
  return result;
}

function perTicket(value: Regressions | "unknown", ticket: string): number[] | undefined {
  assert.notEqual(value, "unknown");
  return (value as Regressions).perTicket.find((row) => row.ticket === ticket)?.bugs;
}

// Fixture regressions (all labelled `regression`): #140 says `caused-by: #116`
// in its body; #141 replies `caused-by: #104` after the Action's question;
// #142 replies `Caused-by: #136`; #143 names PR #42, which merged into a
// feature branch; #144 has no caused-by yet; #145 replies `caused-by: #106`.
describe("regressions", () => {
  it("traces a caused-by line in the issue body to the PR's ticket", async () => {
    const { value } = await regressionRate();
    assert.ok(perTicket(value, "#106")?.includes(140));
  });

  it("traces a caused-by reply to the ticket it names, ignoring the line that only asks for one", async () => {
    const { value } = await regressionRate();
    assert.deepEqual(perTicket(value, "#104"), [141]);
  });

  it("traces a PR that is its own ticket, whatever the case of caused-by", async () => {
    const { value } = await regressionRate();
    assert.deepEqual(perTicket(value, "PR #136"), [142]);
  });

  it("gathers every regression of a ticket, whether it names the issue or one of its PRs", async () => {
    const { value } = await regressionRate();
    assert.deepEqual(perTicket(value, "#106"), [140, 145]);
  });

  it("keeps regressions with no caused-by, or one naming undelivered work, as untraced", async () => {
    const { value } = await regressionRate();
    assert.notEqual(value, "unknown");
    assert.deepEqual((value as Regressions).untraced, [143, 144]);
  });

  // Tickets with regressions are listed in delivery order: #104, PR #136, #106.
  it("gives the share of delivered tickets that caused a regression, over every ticket", async () => {
    assert.deepEqual(await regressionRate(), {
      value: {
        rate: 0.6,
        regressions: 4,
        regressedTickets: 3,
        untraced: [143, 144],
        perTicket: [
          { ticket: "#104", bugs: [141] },
          { ticket: "PR #136", bugs: [142] },
          { ticket: "#106", bugs: [140, 145] },
        ],
      },
      coverage: { tickets: 5, of: 5 },
    });
  });

  it("is unknown, not zero, when no ticket was delivered", async () => {
    assert.deepEqual(await regressionRate("empty", "datasets/grimfeld/agentic-metrics.json"), {
      value: "unknown",
      coverage: { tickets: 0, of: 0 },
    });
  });
});
