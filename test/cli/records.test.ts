import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import type { GitHubSource } from "../../cli/github/source.ts";
import { parseRecords, recordKey } from "../../cli/records.ts";
import type { TranscriptFile, TranscriptSource } from "../../cli/transcripts/source.ts";

// Each test describes a small repo as `gh api` would answer for it. Times are
// hours after 00:00 on DAY; every issue is ready at 00:00. A commit is
// `[when, oid, record?, parents?]`, its record as the recorder writes it.
const DAY = "2026-10-05";
const NOW = new Date("2026-11-09T12:00:00Z");

function at(hours: number): string {
  return new Date(Date.parse(`${DAY}T00:00:00Z`) + Math.round(hours * 3_600_000)).toISOString().replace(".000", "");
}

interface FakeCommit {
  at: number;
  oid: string;
  /** The message's body: its trailers. */
  body?: string;
  subject?: string;
  parents?: string[];
}

interface FakePr {
  number: number;
  head: string;
  base?: string;
  closes: number[];
  mergedAfter: number;
  commits: FakeCommit[];
}

/** A session record as the recorder writes it: active time in minutes. */
function record(key: string, minutes: number, human: number, agents = 0, extra = ""): string {
  return `Co-Authored-By: Claude <noreply@anthropic.com>\nSession-Record: v1 k=${key} active=${String(minutes * 60)} human=${String(human)} agents=${String(agents)} started=${at(0)}${extra}`;
}

function fakeGitHub(issues: number[], prs: FakePr[]): GitHubSource {
  const answers = {
    repo: { full_name: "grimfeld/lifeline", default_branch: "master", private: false },
    regressions: [{ data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } }],
    issues: [
      {
        data: {
          repository: {
            issues: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: issues.map((number) => ({ number, title: `Issue ${String(number)}`, url: `https://github.com/grimfeld/lifeline/issues/${String(number)}`, createdAt: at(0), closedAt: null, timelineItems: { nodes: [] } })),
            },
          },
        },
      },
    ],
    "pull-requests": [
      {
        data: {
          repository: {
            pullRequests: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: prs.map((pr) => ({
                number: pr.number,
                title: `PR ${String(pr.number)}`,
                url: `https://github.com/grimfeld/lifeline/pull/${String(pr.number)}`,
                createdAt: at(1),
                mergedAt: at(pr.mergedAfter),
                baseRefName: pr.base ?? "master",
                headRefName: pr.head,
                author: { login: "grimfeld", __typename: "User" },
                closingIssuesReferences: { nodes: pr.closes.map((number) => ({ number, repository: { nameWithOwner: "grimfeld/lifeline" } })) },
                commits: {
                  nodes: pr.commits.map((commit) => ({
                    commit: {
                      oid: commit.oid,
                      messageHeadline: commit.subject ?? "Work",
                      messageBody: commit.body ?? "",
                      authoredDate: at(commit.at),
                      parents: { nodes: (commit.parents ?? ["base"]).map((oid) => ({ oid })) },
                    },
                  })),
                },
              })),
            },
          },
        },
      },
    ],
    "workflow-runs": [{ total_count: 0, workflow_runs: [] }],
  };
  return { read: (request) => Promise.resolve(answers[request]) };
}

interface Dataset {
  metrics: Record<string, { value: unknown; coverage: { tickets: number; of: number } }>;
}

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-records-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

async function collect(github: GitHubSource, transcripts: TranscriptFile[] = [], config?: object): Promise<{ dataset: Dataset; text: string }> {
  if (config) writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify(config));
  const source: TranscriptSource = { read: () => Promise.resolve(transcripts) };
  const status = await main(["collect"], { cwd, github, transcripts: source, now: () => NOW, stdout: () => undefined, stderr: (text) => assert.fail(text) });
  assert.equal(status, 0);
  const alias = (config as { alias?: string } | undefined)?.alias;
  const text = readFileSync(join(cwd, "datasets", alias ? `${alias}.json` : "grimfeld/lifeline.json"), "utf8");
  return { dataset: JSON.parse(text) as Dataset, text };
}

const human = (dataset: Dataset) => (dataset.metrics["humanMessagesPerTicket"]?.value as { orchestration: number; sources: unknown; perTicket: { ticket: string; messages: number }[] });
const activeRows = (dataset: Dataset, id = "activeTime") => (dataset.metrics[id]?.value as { tickets: { ticket: string; hours: number }[] }).tickets;

const A = "aaaaaaaaaaaa";
const B = "bbbbbbbbbbbb";
const C = "cccccccccccc";

describe("session records: parsing", () => {
  it("reads a record as the recorder writes it, among other trailers", () => {
    const body = `Fix the hook.\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nSession-Record: v1 k=3fa9c1d2e4b7 active=754 human=3 agents=2 started=2026-11-10T18:00:00Z parent=${A}`;

    assert.deepEqual(parseRecords(body), [{ key: "3fa9c1d2e4b7", activeMs: 754_000, human: 3, agents: 2, startedAt: new Date("2026-11-10T18:00:00Z"), parent: A }]);
  });

  it("ignores a line that is not a record, never failing on it", () => {
    for (const body of ["", "Session-Record: v1", "Session-Record: v2 k=abc123 active=5", "Session-Record: v1 k=NOTHEX active=5", "Session-Record: v1 k=abc123 active=soon", "see Session-Record: v1 k=abc123 active=5"]) {
      assert.deepEqual(parseRecords(body), [], body);
    }
  });

  it("keeps one record per session: its highest counters, when an amended commit carries two", () => {
    const records = parseRecords(`Session-Record: v1 k=${A} active=60 human=1 agents=0\nSession-Record: v1 k=${A} active=120 human=2 agents=0\nSession-Record: v1 k=${B} active=30 human=0 agents=0`);

    assert.deepEqual(records.map(({ key, activeMs, human }) => ({ key, activeMs, human })), [{ key: A, activeMs: 120_000, human: 2 }, { key: B, activeMs: 30_000, human: 0 }]);
  });
});

describe("session records: collect", () => {
  it("splits one session's messages and active time between the tickets it committed on", async () => {
    // Session A: 30 minutes and 3 messages by its commit on #1, then 50 minutes and 4 messages by its commit on #2.
    const github = fakeGitHub(
      [1, 2],
      [
        { number: 10, head: "ticket-1", closes: [1], mergedAfter: 10, commits: [{ at: 4, oid: "c1", body: record(A, 30, 3) }] },
        { number: 11, head: "ticket-2", closes: [2], mergedAfter: 12, commits: [{ at: 6, oid: "c2", body: record(A, 50, 4) }] },
      ],
    );
    const { dataset } = await collect(github);

    assert.deepEqual(human(dataset).perTicket, [{ ticket: "#1", messages: 3 }, { ticket: "#2", messages: 1 }]);
    assert.deepEqual(human(dataset).sources, { transcripts: 0, records: 2 });
    assert.deepEqual(activeRows(dataset), [{ ticket: "#1", hours: 0.5 }, { ticket: "#2", hours: 0.33 }]);
    // Measured, so neither is estimated from its commits.
    assert.equal(dataset.metrics["estimatedActiveTime"]?.value, "unknown");
  });

  it("places the time a commit added just before it: the ticket's work starts there, not at the commit", async () => {
    // Ready at 00:00; one commit at 04:00 carrying 30 minutes; merged at 10:00.
    const github = fakeGitHub([1], [{ number: 10, head: "ticket-1", closes: [1], mergedAfter: 10, commits: [{ at: 4, oid: "c1", body: record(A, 30, 1) }] }]);
    const { dataset } = await collect(github);

    assert.deepEqual((dataset.metrics["leadTime"]?.value as { tickets: unknown[] }).tickets, [{ ticket: "#1", hours: 10, queueHours: 3.5, workHours: 0.5, landingHours: 6 }]);
  });

  it("reads a session from its transcript when one is cached, and ignores its records", async () => {
    // The transcript: one hour on ticket-1, one human message. Its records claim 5 hours and 9 messages.
    const sessionId = "11111111-2222-4333-8444-555555555555";
    const lines = Array.from({ length: 21 }, (_, index) => ({
      type: index === 0 ? "user" : "assistant",
      sessionId,
      uuid: `u${String(index)}`,
      timestamp: at(4 + index * 0.05),
      gitBranch: "ticket-1",
      cwd: "/Users/dev/repos/lifeline",
      ...(index === 0 ? { message: { role: "user", content: "Implement the ticket" } } : {}),
    }));
    const github = fakeGitHub([1], [{ number: 10, head: "ticket-1", closes: [1], mergedAfter: 10, commits: [{ at: 5, oid: "c1", body: record(recordKey(sessionId), 300, 9) }] }]);
    const { dataset } = await collect(github, [{ session: sessionId, lines }]);

    assert.deepEqual(human(dataset).perTicket, [{ ticket: "#1", messages: 1 }]);
    assert.deepEqual(human(dataset).sources, { transcripts: 1, records: 0 });
    assert.deepEqual(activeRows(dataset), [{ ticket: "#1", hours: 1 }]);
  });

  it("counts a sub-agent's record as a sub-agent on its ticket, with no human message, and once with its parent's count", async () => {
    // Sub-agent B (parent A) commits on #1; A, which spawned 2 sub-agents, commits on #1 too.
    const github = fakeGitHub(
      [1],
      [
        {
          number: 10,
          head: "ticket-1",
          closes: [1],
          mergedAfter: 10,
          commits: [
            { at: 4, oid: "c1", body: record(B, 20, 0, 0, ` parent=${A}`) },
            { at: 5, oid: "c2", body: record(A, 10, 1, 2) },
          ],
        },
      ],
    );
    const { dataset } = await collect(github);

    assert.deepEqual(human(dataset).perTicket, [{ ticket: "#1", messages: 1 }]);
    // B is one of A's two: 2 sub-agents, not 3. Their model is not recorded.
    assert.deepEqual((dataset.metrics["subAgents"]?.value as { perTicket: unknown[] }).perTicket, [{ ticket: "#1", subAgents: 2, models: [{ model: "unknown", subAgents: 2 }] }]);
    // Wall-clock: B's 20 minutes end at 04:00, A's 10 at 05:00.
    assert.deepEqual(activeRows(dataset), [{ ticket: "#1", hours: 0.5 }]);
  });

  it("counts what a batch merge adds as orchestration, on no ticket", async () => {
    // Sub-agent B did #1 on its branch, merged into the batch by session A's merge commit, which carries A's record.
    const github = fakeGitHub(
      [1],
      [
        { number: 10, head: "ticket-1", base: "integration/spec", closes: [1], mergedAfter: 5, commits: [{ at: 4, oid: "c1", body: record(B, 20, 0, 0, ` parent=${A}`) }, { at: 4.25, oid: "c1b", body: record(B, 30, 0, 0, ` parent=${A}`) }] },
        {
          number: 20,
          head: "integration/spec",
          closes: [],
          mergedAfter: 8,
          commits: [
            { at: 4, oid: "c1", body: record(B, 20, 0, 0, ` parent=${A}`) },
            { at: 4.25, oid: "c1b", body: record(B, 30, 0, 0, ` parent=${A}`) },
            { at: 5, oid: "m1", subject: "Merge ticket-1: Thing (#1)", body: record(A, 45, 6, 1), parents: ["base", "c1b"] },
          ],
        },
      ],
    );
    const { dataset } = await collect(github);

    // The ticket shows the sub-agent's work and none of the 6 messages that steered it...
    assert.deepEqual(human(dataset).perTicket, [{ ticket: "#1", messages: 0 }]);
    assert.deepEqual(activeRows(dataset), [{ ticket: "#1", hours: 0.5 }]);
    // ...which are orchestration, shown beside the per-ticket figure.
    assert.equal(human(dataset).orchestration, 6);
    assert.deepEqual(dataset.metrics["orchestrationTime"]?.value, { hours: 0.8, sessions: 1, subAgents: 1, humanMessages: 6 });
  });

  it("lets a ticket done in a cloud session be full autonomy: its human messages are known", async () => {
    const cloud = (key: string, minutes: number, messages: number) => `${record(key, minutes, messages)}\nClaude-Session: https://claude.ai/code/session_01ABC`;
    const github = fakeGitHub(
      [1, 2],
      [
        { number: 10, head: "ticket-1", closes: [1], mergedAfter: 10, commits: [{ at: 4, oid: "c1", body: cloud(A, 30, 1) }] },
        { number: 11, head: "ticket-2", closes: [2], mergedAfter: 12, commits: [{ at: 6, oid: "c2", body: cloud(C, 30, 7) }] },
      ],
    );
    const { dataset } = await collect(github);

    assert.deepEqual(
      (dataset.metrics["autonomy"]?.value as { perTicket: { ticket: string; level: string }[] }).perTicket.map(({ ticket, level }) => ({ ticket, level })),
      [{ ticket: "#1", level: "full" }, { ticket: "#2", level: "assisted" }],
    );
  });

  it("keeps cost unknown, not $0, for a ticket known only through records", async () => {
    const github = fakeGitHub([1], [{ number: 10, head: "ticket-1", closes: [1], mergedAfter: 10, commits: [{ at: 4, oid: "c1", body: record(A, 30, 1) }] }]);
    const { dataset } = await collect(github);

    assert.deepEqual(dataset.metrics["apiEquivalentCost"], { value: "unknown", coverage: { tickets: 0, of: 1 } });
    assert.deepEqual(dataset.metrics["activeTime"]?.coverage, { tickets: 1, of: 1 });
  });

  it("ignores a malformed record: the ticket is as if it had none", async () => {
    const github = fakeGitHub([1], [{ number: 10, head: "ticket-1", closes: [1], mergedAfter: 10, commits: [{ at: 4, oid: "c1", body: "Session-Record: v1 k=??? active=lots" }, { at: 4.25, oid: "c2" }] }]);
    const { dataset } = await collect(github);

    assert.equal(dataset.metrics["humanMessagesPerTicket"]?.value, "unknown");
    assert.deepEqual(activeRows(dataset, "estimatedActiveTime"), [{ ticket: "#1", hours: 0.25 }]);
  });

  it("publishes no session key, in a full dataset or an anonymized one", async () => {
    const github = fakeGitHub([1], [{ number: 10, head: "ticket-1", closes: [1], mergedAfter: 10, commits: [{ at: 4, oid: "c1", body: record(A, 30, 2, 1) }] }]);

    assert.doesNotMatch((await collect(github)).text, /aaaaaaaaaaaa|record:/);
    const anonymized = await collect(github, [], { publish: "anonymized", alias: "client-a" });
    assert.doesNotMatch(anonymized.text, /aaaaaaaaaaaa|record:/);
    assert.deepEqual(anonymized.dataset.metrics["humanMessagesPerTicket"]?.value, { p50: 2, p90: 2, mean: 2, orchestration: 0, sources: { transcripts: 0, records: 1 } });
  });
});
