import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";
import { transcriptCache } from "../../cli/transcripts/source.ts";

const GITHUB = join(import.meta.dirname, "../fixtures/github");
const CACHE = join(import.meta.dirname, "../fixtures/transcript-cache/lifeline");
const NOW = new Date("2026-11-09T12:00:00Z");
const REPO_DIR = "/Users/dev/repos/lifeline";

// The lifeline fixtures, as autonomy sees them (see transcripts.test.ts for the sessions):
//   #104 and #105, PR #115: 3 human messages; one commit co-authored by Claude, one by hand.
//      #105 carries the label `autonomy:full`.
//   #106, PRs #116 and #117: 1 human message; every commit co-authored by Claude.
//   PR #136: no transcript; its one commit co-authored by a person.
//   PR #137: 2 human messages; its one commit made in a cloud session (`Claude-Session:` trailer).

let cwd: string;
let stderr: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-autonomy-"));
  stderr = "";
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

async function run(argv: string[], options: { github?: string; repoDir?: string } = {}) {
  const status = await main(argv, {
    cwd,
    github: fixtureSource(options.github ?? join(GITHUB, "lifeline")),
    transcripts: transcriptCache({ dir: CACHE, repoDir: options.repoDir ?? REPO_DIR }),
    now: () => NOW,
    stdout: () => undefined,
    stderr: (text) => (stderr += text),
  });
  assert.equal(status, 0, stderr);
}

function config(fields: object) {
  writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify(fields));
}

function autonomy(path = "datasets/grimfeld/lifeline.json"): unknown {
  return (JSON.parse(readFileSync(join(cwd, path), "utf8")) as { metrics: Record<string, unknown> }).metrics["autonomy"];
}

describe("autonomy", () => {
  it("gives each ticket a level from its human messages and Claude co-author trailers; a label wins", async () => {
    await run(["collect"]);

    assert.deepEqual(autonomy(), {
      value: {
        full: 3,
        assisted: 1,
        manual: 1,
        overridden: 1,
        perTicket: [
          { ticket: "#104", level: "assisted", computed: "assisted", overridden: false },
          { ticket: "#105", level: "full", computed: "assisted", overridden: true },
          { ticket: "PR #136", level: "manual", computed: "manual", overridden: false },
          { ticket: "#106", level: "full", computed: "full", overridden: false },
          { ticket: "PR #137", level: "full", computed: "full", overridden: false },
        ],
      },
      coverage: { tickets: 5, of: 5 },
    });
  });

  it("reads the thresholds from the config", async () => {
    config({ autonomy: { fullMaxFollowUps: 2, fullMinClaudeCommitShare: 0.5 } });
    await run(["collect"]);
    const levels = (autonomy() as { value: { perTicket: { ticket: string; computed: string }[] } }).value.perTicket;
    assert.equal(levels.find((row) => row.ticket === "#104")?.computed, "full");

    config({ autonomy: { fullMaxFollowUps: 0 } });
    await run(["collect"]);
    const strict = (autonomy() as { value: { perTicket: { ticket: string; computed: string }[] } }).value.perTicket;
    assert.deepEqual(
      strict.map((row) => [row.ticket, row.computed]),
      [["#104", "assisted"], ["#105", "assisted"], ["PR #136", "manual"], ["#106", "full"], ["PR #137", "assisted"]],
    );
  });

  it("rejects thresholds out of range", async () => {
    config({ autonomy: { fullMinClaudeCommitShare: 2 } });
    const status = await main(["collect"], {
      cwd,
      github: fixtureSource(join(GITHUB, "lifeline")),
      now: () => NOW,
      stdout: () => undefined,
      stderr: (text) => (stderr += text),
    });
    assert.equal(status, 1);
    assert.match(stderr, /autonomy\.fullMinClaudeCommitShare/);
  });

  it("never rates a ticket full without a transcript: Claude commits alone make it assisted", async () => {
    await run(["collect"], { repoDir: "/Users/dev/repos/no-such-clone" });

    const value = (autonomy() as { value: { perTicket: unknown[] } }).value;
    assert.deepEqual(value.perTicket, [
      { ticket: "#104", level: "assisted", computed: "assisted", overridden: false },
      { ticket: "#105", level: "full", computed: "assisted", overridden: true },
      { ticket: "PR #136", level: "manual", computed: "manual", overridden: false },
      { ticket: "#106", level: "assisted", computed: "assisted", overridden: false },
      { ticket: "PR #137", level: "assisted", computed: "assisted", overridden: false },
    ]);
  });

  it("takes an override from a PR that is its own ticket, and ignores unknown autonomy labels", async () => {
    const github = join(cwd, "github");
    cpSync(join(GITHUB, "lifeline"), github, { recursive: true });
    const path = join(github, "pull-requests.json");
    const pages = JSON.parse(readFileSync(path, "utf8")) as { data: { repository: { pullRequests: { nodes: { number: number; labels?: unknown }[] } } } }[];
    for (const pr of pages.flatMap((page) => page.data.repository.pullRequests.nodes)) {
      if (pr.number === 136) pr.labels = { nodes: [{ name: "autonomy:assisted" }] };
      if (pr.number === 137) pr.labels = { nodes: [{ name: "autonomy:sometimes" }] };
    }
    writeFileSync(path, JSON.stringify(pages));
    await run(["collect"], { github });

    const value = (autonomy() as { value: { overridden: number; perTicket: { ticket: string }[] } }).value;
    assert.equal(value.overridden, 2);
    assert.deepEqual(
      value.perTicket.filter((row) => row.ticket.startsWith("PR")),
      [
        { ticket: "PR #136", level: "assisted", computed: "manual", overridden: true },
        { ticket: "PR #137", level: "full", computed: "full", overridden: false },
      ],
    );
  });

  it("keeps the counts only when anonymized", async () => {
    config({ publish: "anonymized", alias: "side-project" });
    await run(["collect"]);

    assert.deepEqual(autonomy("datasets/side-project.json"), {
      value: { full: 3, assisted: 1, manual: 1, overridden: 1 },
      coverage: { tickets: 5, of: 5 },
    });
  });

  it("shows the levels and the overridden count in the report, and defines the rule in Methodology", async () => {
    await run(["collect"]);
    await run(["report"]);
    const html = readFileSync(join(cwd, "report/index.html"), "utf8");
    const text = (pattern: RegExp) => (pattern.exec(html)?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    assert.match(text(/data-section="autonomy">([\s\S]*?)<\/section>/), /^Autonomy level Full 3 Assisted 1 Manual 1 1 of 5 tickets overridden by an autonomy:\* label\./);
    assert.match(text(/data-methodology="autonomy">([\s\S]*?)<\/article>/), /Co-Authored-By/);
    assert.match(text(/data-methodology="autonomy">([\s\S]*?)<\/article>/), /Coverage: grimfeld\/lifeline 5 of 5 tickets/);
  });
});
