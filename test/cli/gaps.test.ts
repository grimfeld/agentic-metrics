import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";
import { readConfig } from "../../cli/config.ts";
import { anonymizeGaps, findGaps, type Gap } from "../../cli/gaps.ts";
import type { GitHubData } from "../../cli/github/load.ts";
import type { LinkedWork } from "../../cli/linker.ts";
import type { Session } from "../../cli/transcripts/load.ts";

const FIXTURES = join(import.meta.dirname, "../fixtures/github");
const NOW = new Date("2026-11-09T12:00:00Z");
const RECORDER_HOOK = { hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PROJECT_DIR:-.}/.agentic-metrics/recorder.mjs"' }] }] } };

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-gaps-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

async function gaps(fixture: string, path = "datasets/grimfeld/lifeline.json"): Promise<Gap[]> {
  const status = await main(["collect"], { cwd, github: fixtureSource(fixture.startsWith("/") ? fixture : join(FIXTURES, fixture)), now: () => NOW, stdout: () => {} });
  assert.equal(status, 0);
  return (JSON.parse(readFileSync(join(cwd, path), "utf8")) as { gaps: Gap[] }).gaps;
}

const find = (all: Gap[], id: string) => all.find((gap) => gap.id === id);

function git(...args: string[]) {
  execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "ignore" });
}

function installRecorder() {
  mkdirSync(join(cwd, ".agentic-metrics"), { recursive: true });
  writeFileSync(join(cwd, ".agentic-metrics/recorder.mjs"), "// recorder\n");
  mkdirSync(join(cwd, ".claude"), { recursive: true });
  writeFileSync(join(cwd, ".claude/settings.json"), JSON.stringify(RECORDER_HOOK));
}

describe("gaps", () => {
  it("names the tickets that have neither a transcript nor a session record, with init as the fix", async () => {
    git("init", "-q");
    const gap = find(await gaps("lifeline"), "no-session-data");

    assert.ok(gap);
    assert.equal(gap.tickets, 5);
    assert.deepEqual(gap.ticketIds, ["#104", "#105", "PR #136", "#106", "PR #137"]);
    assert.ok(gap.metrics.includes("humanMessagesPerTicket"));
    assert.deepEqual(gap.fix, { kind: "command", command: "npx agentic-metrics init" });
  });

  it("says the recorder is missing, as a repo-level gap", async () => {
    git("init", "-q");
    const gap = find(await gaps("lifeline"), "recorder-missing");

    assert.ok(gap);
    assert.equal(gap.tickets, undefined);
    assert.deepEqual(gap.fix, { kind: "command", command: "npx agentic-metrics init" });
  });

  it("says the recorder is installed but not committed, with committing its two files as the fix", async () => {
    git("init", "-q");
    installRecorder();
    const all = await gaps("lifeline");

    assert.equal(find(all, "recorder-missing"), undefined);
    assert.deepEqual(find(all, "recorder-not-committed")?.fix, {
      kind: "command",
      command: 'git add .agentic-metrics/recorder.mjs .claude/settings.json && git commit -m "Install the agentic-metrics recorder"',
    });
  });

  it("finds no recorder gap once it is committed, and points tickets without data at their transcripts", async () => {
    git("init", "-q");
    installRecorder();
    git("add", ".");
    git("commit", "-q", "-m", "recorder");
    const all = await gaps("lifeline");

    assert.equal(find(all, "recorder-missing"), undefined);
    assert.equal(find(all, "recorder-not-committed"), undefined);
    assert.equal(find(all, "no-session-data")?.fix.kind, "command");
    assert.match(JSON.stringify(find(all, "no-session-data")?.fix), /import-transcripts/);
  });

  it("can't tell whether a recorder outside a git repo is committed, and says nothing about it", async () => {
    installRecorder();
    const all = await gaps("lifeline");

    assert.equal(find(all, "recorder-missing"), undefined);
    assert.equal(find(all, "recorder-not-committed"), undefined);
  });

  it("names ciWorkflow as the fix when the main CI workflow was guessed", async () => {
    const gap = find(await gaps("ci", "datasets/grimfeld/ci.json"), "ci-workflow-guessed");

    assert.ok(gap);
    assert.ok(gap.metrics.includes("firstRunCiRate"));
    assert.ok(gap.fix.kind === "config" && gap.fix.text.includes('"ciWorkflow": ".github/workflows/check.yml"'));
  });

  it("finds no guessed-workflow gap when ciWorkflow is set", async () => {
    writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify({ ciWorkflow: "check.yml" }));
    const all = await gaps("ci", "datasets/grimfeld/ci.json");

    assert.equal(find(all, "ci-workflow-guessed"), undefined);
    assert.equal(find(all, "ci-workflow-not-found"), undefined);
  });

  it("says when the configured ciWorkflow never ran", async () => {
    writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify({ ciWorkflow: "nope.yml" }));
    const gap = find(await gaps("ci", "datasets/grimfeld/ci.json"), "ci-workflow-not-found");

    assert.ok(gap);
    assert.equal(gap.fix.kind, "config");
  });

  it("counts the tickets whose issue never got the ready label", async () => {
    const gap = find(await gaps("lifeline"), "not-labelled-ready");

    // #104 and #106 got `ready-for-agent`; #105 never did. PRs that are their own ticket have no issue to label.
    assert.ok(gap);
    assert.deepEqual(gap.ticketIds, ["#105"]);
    assert.deepEqual(gap.metrics, ["leadTime"]);
    assert.equal(gap.fix.kind, "convention");
  });

  it("says no regression is recorded when the repo has none", async () => {
    assert.equal(find(await gaps("lifeline"), "no-regressions-declared"), undefined);
    const gap = find(await gaps("ci", "datasets/grimfeld/ci.json"), "no-regressions-declared");

    assert.ok(gap);
    assert.deepEqual(gap.metrics, ["regressionRate"]);
  });

  it("says the Action is not installed when its workflow is absent and never ran", async () => {
    git("init", "-q");
    const gap = find(await gaps("lifeline"), "action-missing");

    assert.ok(gap);
    assert.deepEqual(gap.fix, { kind: "command", command: "npx agentic-metrics init" });
  });

  it("says the Action is blocked when its latest run could not start", async () => {
    const fixture = join(cwd, "fixture");
    cpSync(join(FIXTURES, "lifeline"), fixture, { recursive: true });
    const runs = JSON.parse(readFileSync(join(fixture, "workflow-runs.json"), "utf8")) as { workflow_runs: unknown[] }[];
    const run = { name: "agentic-metrics", path: ".github/workflows/agentic-metrics.yml", event: "pull_request", status: "completed", head_branch: "x", head_sha: "0", run_attempt: 1 };
    runs[0]?.workflow_runs.unshift(
      { ...run, id: 2, conclusion: "startup_failure", created_at: "2026-11-02T00:00:00Z" },
      { ...run, id: 1, conclusion: "success", created_at: "2026-11-01T00:00:00Z" },
    );
    writeFileSync(join(fixture, "workflow-runs.json"), JSON.stringify(runs));
    const all = await gaps(fixture);

    assert.equal(find(all, "action-missing"), undefined);
    assert.equal(find(all, "action-blocked")?.fix.kind, "settings");
    assert.match(JSON.stringify(find(all, "action-blocked")?.fix), /grimfeld\/agentic-metrics\/action@\*/);
  });

  it("keeps an anonymized dataset's gaps to counts: no ticket number, title or link", async () => {
    writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify({ publish: "anonymized", alias: "client-a" }));
    const all = await gaps("lifeline", "datasets/client-a.json");

    assert.equal(find(all, "no-session-data")?.tickets, 5);
    for (const gap of all) assert.equal(gap.ticketIds, undefined);
    assert.doesNotMatch(JSON.stringify(all), /#1\d\d|lifeline|https?:/);
  });

  it("reads a dataset written before gaps as having none", async () => {
    await gaps("lifeline");
    const file = join(cwd, "datasets/grimfeld/lifeline.json");
    const dataset = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    delete dataset["gaps"];
    writeFileSync(file, JSON.stringify(dataset));

    assert.equal(await main(["report"], { cwd, stdout: () => {} }), 0);
  });
});

describe("gaps: devices", () => {
  /** A session read from records, on `device`; `cloud` when its commits came from a cloud session. */
  const recorded = (key: string, device?: string, cloud = false) =>
    ({ sessionId: `record:${key}`, agentId: undefined, recorded: { parent: undefined, device, cloud }, humanMessages: [], spawns: [], responses: [] }) as unknown as Session;
  const transcript = { sessionId: "s1", agentId: undefined, humanMessages: [], spawns: [], responses: [] } as unknown as Session;

  function devices(tickets: { id: string; sessions: Session[] }[], orchestration: Session[] = []) {
    const work = { tickets: tickets.map((ticket) => ({ ...ticket, pullRequests: [] })), transcripts: { sessions: 0, orchestration }, ci: { mainWorkflow: "check.yml" } } as unknown as LinkedWork;
    const data = { actionRuns: [{ createdAt: new Date(), conclusion: "success" }], regressions: [{}] } as unknown as GitHubData;
    return findGaps({ work, data, config: readConfig(cwd), checkout: undefined }).filter((gap) => gap.id === "device-transcripts");
  }

  it("names the other device whose sessions have only records here, with the tickets they worked on", () => {
    const gaps = devices([
      { id: "#1", sessions: [transcript] },
      { id: "#2", sessions: [recorded("aa", "0a1b2c3d")] },
      { id: "#3", sessions: [recorded("aa", "0a1b2c3d"), recorded("bb", "0a1b2c3d")] },
    ]);

    const [gap, ...rest] = gaps;
    assert.ok(gap);
    assert.equal(rest.length, 0);
    assert.equal(gap.device, "0a1b2c3d");
    assert.match(gap.cause, /^2 sessions from device 0a1b2c3d have no transcript here/);
    assert.deepEqual(gap.ticketIds, ["#2", "#3"]);
    assert.match(JSON.stringify(gap.fix), /import-transcripts <device 0a1b2c3d's/);
  });

  it("counts records that name no device under an unknown device", () => {
    const gaps = devices([{ id: "#1", sessions: [recorded("aa")] }], [recorded("cc", "ffff0000")]);

    assert.deepEqual(gaps.map((gap) => [gap.device, gap.tickets]), [["ffff0000", undefined], ["unknown", 1]]);
  });

  it("leaves cloud sessions out: no device holds their transcript", () => {
    assert.deepEqual(devices([{ id: "#1", sessions: [recorded("aa", "0a1b2c3d", true)] }]), []);
  });
});

describe("gaps: cloud sessions", () => {
  const commit = (cloudSessionId?: string, records: unknown[] = []) => ({ cloudSession: cloudSessionId !== undefined, cloudSessionId, records });
  const ticket = (id: string, commits: unknown[], sessions: unknown[] = []) => ({ id, sessions, pullRequests: [{ commits, labels: [] }], batchCommits: [] });

  function cloud(tickets: unknown[], publish: "full" | "anonymized" = "full") {
    const work = { tickets, transcripts: { sessions: 0, orchestration: [] }, ci: { mainWorkflow: "check.yml" } } as unknown as LinkedWork;
    const data = { actionRuns: [{ createdAt: new Date(), conclusion: "success" }], regressions: [{}] } as unknown as GitHubData;
    const gaps = findGaps({ work, data, config: readConfig(cwd), checkout: undefined });
    return (publish === "anonymized" ? anonymizeGaps(gaps) : gaps).find((gap) => gap.id === "cloud-sessions");
  }

  it("gives the teleport command of each cloud session with neither a record nor a transcript", () => {
    const gap = cloud([ticket("#1", [commit("session_01ABC"), commit("session_01ABC")]), ticket("#2", [commit("session_02DEF"), commit()])]);

    assert.ok(gap);
    assert.deepEqual(gap.ticketIds, ["#1", "#2"]);
    assert.deepEqual(gap.fix, { kind: "command", command: "claude --teleport session_01ABC\nclaude --teleport session_02DEF" });
  });

  it("reads the session id from the commit's Claude-Session trailer", async () => {
    // PR #137's one commit was made in cloud session session_01ABCDEF, and no transcript is read here.
    const gap = find(await gaps("lifeline"), "cloud-sessions");

    assert.deepEqual(gap?.fix, { kind: "command", command: "claude --teleport session_01ABCDEF" });
    assert.deepEqual(gap.ticketIds, ["PR #137"]);
  });

  it("suggests nothing for a cloud commit that carries a session record", () => {
    assert.equal(cloud([ticket("#1", [commit("session_01ABC", [{ key: "aa" }])])]), undefined);
  });

  it("suggests nothing for a ticket whose sessions are already known", () => {
    assert.equal(cloud([ticket("#1", [commit("session_01ABC")], [{ sessionId: "s" }])]), undefined);
  });

  it("names no session in an anonymized dataset", () => {
    const gap = cloud([ticket("#1", [commit("session_01ABC")])], "anonymized");

    assert.ok(gap);
    assert.doesNotMatch(JSON.stringify(gap), /session_01ABC|#1/);
  });
});
