import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { readRepo } from "./report-pages.ts";
import { fixtureSource } from "../../cli/github/source.ts";
import { transcriptCache } from "../../cli/transcripts/source.ts";

const GITHUB = join(import.meta.dirname, "../fixtures/github");
const CACHE = join(import.meta.dirname, "../fixtures/transcript-cache/lifeline");
const NOW = new Date("2026-11-09T12:00:00Z");

// The transcript cache fixture, for the clone at /Users/dev/repos/lifeline
// (see the comments in each session for what it exercises):
//   S1 on master: orchestration, 2 human messages, 30 min active;
//      sub-agent A1 moves to spec/106-… (#106), sub-agent A2 has no branch (orchestration).
//   S2 on `demo`, PR #115's head (#104 and #105): 3 human messages among
//      slash commands, tool results, notifications, meta lines and a repeat;
//      sub-agent B1 has no branch and inherits #104 and #105.
//   S3 in worktree `ticket-137`: PR #137, 2 human messages.
//   S4 on master with a pr-link to PR #116: #106, 1 human message.
//   S5 on spec/107-… (not delivered) and a session of another clone: nowhere.
// PR #136 has no transcript.
const REPO_DIR = "/Users/dev/repos/lifeline";

let cwd: string;
let stderr: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-transcripts-"));
  stderr = "";
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

async function run(argv: string[], options: { github?: string; cache?: string; repoDir?: string } = {}) {
  const status = await main(argv, {
    cwd,
    github: fixtureSource(join(GITHUB, options.github ?? "lifeline")),
    transcripts: transcriptCache({ dir: options.cache ?? CACHE, repoDir: options.repoDir ?? REPO_DIR }),
    now: () => NOW,
    stdout: () => undefined,
    stderr: (text) => (stderr += text),
  });
  assert.equal(status, 0, stderr);
}

async function collect(options: { github?: string; cache?: string; repoDir?: string } = {}) {
  await run(["collect"], options);
}

function datasetText(repo = "grimfeld/lifeline"): string {
  return readFileSync(join(cwd, "datasets", `${repo}.json`), "utf8");
}

function metric(id: string, repo?: string): unknown {
  return (JSON.parse(datasetText(repo)) as { metrics: Record<string, unknown> }).metrics[id];
}

describe("transcripts", () => {
  it("counts human messages per ticket, linking sessions by branch, worktree, pr-link and parent", async () => {
    await collect();

    assert.deepEqual(metric("humanMessagesPerTicket"), {
      value: {
        p50: 2,
        p90: 3,
        mean: 2.3,
        perTicket: [
          { ticket: "#104", messages: 3 },
          { ticket: "#105", messages: 3 },
          { ticket: "#106", messages: 1 },
          { ticket: "PR #137", messages: 2 },
        ],
      },
      coverage: { tickets: 4, of: 5 },
    });
  });

  it("reports sessions that name no work as orchestration time, sub-agents included", async () => {
    await collect();

    assert.deepEqual(metric("orchestrationTime"), {
      value: { hours: 0.5, sessions: 1, subAgents: 1, humanMessages: 2 },
      coverage: { tickets: 4, of: 5 },
    });
  });

  it("reports transcript metrics as unknown, not zero, when no transcript was read", async () => {
    await collect({ repoDir: "/Users/dev/repos/no-such-clone" });

    assert.deepEqual(metric("humanMessagesPerTicket"), { value: "unknown", coverage: { tickets: 0, of: 5 } });
    assert.deepEqual(metric("orchestrationTime"), { value: "unknown", coverage: { tickets: 0, of: 5 } });
  });

  it("reads real transcripts: typed prompts count, a slash command and agent messages don't", async () => {
    // The scrubbed fixture of the plugin's hook test: one session on a detached
    // HEAD with a sub-agent in a worktree, so both are orchestration.
    const cache = join(cwd, "cache");
    cpSync(join(import.meta.dirname, "../fixtures/transcripts"), join(cache, "-Users-dev-repos-jellyfin-comics-reader"), { recursive: true });
    await collect({ github: "empty", cache, repoDir: "/Users/dev/repos/jellyfin-comics-reader" });

    const result = metric("orchestrationTime", "grimfeld/agentic-metrics") as { value: { sessions: number; subAgents: number; humanMessages: number } };
    assert.equal(result.value.sessions, 1);
    assert.equal(result.value.subAgents, 1);
    assert.equal(result.value.humanMessages, 2);
  });

  it("publishes no transcript text, account or organisation identifier, session id or path", async () => {
    await collect();

    const text = datasetText();
    assert.notEqual((metric("humanMessagesPerTicket") as { value: unknown }).value, "unknown");
    for (const leak of [
      /SECRET/,
      /dev@example\.com/,
      /11111111-2222/,
      /66666666-7777/,
      /aaaaaaaa-0000/,
      /a1000000000000001|a2000000000000002|b1000000000000001/,
      /msg_|req_|toolu_/,
      /\/Users\//,
      /worktree/,
      /spec\/10\d|type-editor|demo/,
    ]) {
      assert.doesNotMatch(text, leak);
    }
  });

  it("fills the human messages headline card, and defines both metrics in Methodology", async () => {
    await collect();
    await run(["report"]);
    const html = readRepo(join(cwd, "report"), "grimfeld/lifeline");
    const text = (pattern: RegExp) => (pattern.exec(html)?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    assert.equal(text(/<article class="card" data-metric="humanMessagesPerTicket">([\s\S]*?)<\/article>/), "Human messages per ticket 2 p50 · 3 p90 4 of 5 tickets");
    assert.equal(text(/data-section="orchestrationTime">([\s\S]*?)<\/section>/), "Orchestration time 0.5 h in 1 session on no ticket, with 2 human messages and 1 sub-agent.");
    assert.match(text(/data-methodology="humanMessagesPerTicket">([\s\S]*?)<\/article>/), /Coverage: grimfeld\/lifeline 4 of 5 tickets/);
    assert.match(text(/data-methodology="orchestrationTime">([\s\S]*?)<\/article>/), /^Orchestration time Active time/);
  });

  it("keeps aggregates only when anonymized", async () => {
    writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify({ publish: "anonymized", alias: "side-project" }));
    await collect();

    const metrics = (JSON.parse(readFileSync(join(cwd, "datasets/side-project.json"), "utf8")) as { metrics: Record<string, { value: unknown }> }).metrics;
    assert.deepEqual(metrics["humanMessagesPerTicket"]?.value, { p50: 2, p90: 3, mean: 2.3 });
    assert.deepEqual(metrics["orchestrationTime"]?.value, { hours: 0.5, sessions: 1, subAgents: 1, humanMessages: 2 });
  });
});
