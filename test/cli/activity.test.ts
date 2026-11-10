import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource, type GitHubSource } from "../../cli/github/source.ts";
import type { TranscriptFile, TranscriptSource } from "../../cli/transcripts/source.ts";

// Each test describes a small repo as `gh api` would answer for it, and the
// transcripts cached for it. Times are hours after 00:00 on DAY. An issue is
// created at 00:00; `ready` is when it got the ready label.
const DAY = "2026-10-05";
const NOW = new Date("2026-11-09T12:00:00Z");
const BATCH = join(import.meta.dirname, "../fixtures/github/batch");

function at(hours: number): string {
  return new Date(Date.parse(`${DAY}T00:00:00Z`) + hours * 3_600_000).toISOString().replace(".000", "");
}

interface FakeIssue {
  number: number;
  /** When it was labelled ready; never, without it. */
  ready?: number;
  /** Comments by a person: when, and what. */
  comments?: { after: number; body: string }[];
}

interface FakePr {
  number: number;
  head: string;
  closes: number[];
  openedAfter: number;
  mergedAfter: number;
  /** When each of its commits was authored. */
  commitsAt: number[];
}

function fakeGitHub(issues: FakeIssue[], prs: FakePr[]): GitHubSource {
  const answers = {
    repo: { full_name: "grimfeld/lifeline", default_branch: "master", private: false },
    regressions: [{ data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } }],
    issues: [
      {
        data: {
          repository: {
            issues: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: issues.map((issue) => ({
                number: issue.number,
                title: `Issue ${String(issue.number)}`,
                url: `https://github.com/grimfeld/lifeline/issues/${String(issue.number)}`,
                createdAt: at(0),
                closedAt: null,
                timelineItems: {
                  nodes: issue.ready === undefined ? [] : [{ __typename: "LabeledEvent", createdAt: at(issue.ready), label: { name: "ready-for-agent" } }],
                },
                comments: { nodes: (issue.comments ?? []).map((comment) => ({ createdAt: at(comment.after), body: comment.body, author: { __typename: "User" } })) },
              })),
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
                createdAt: at(pr.openedAfter),
                mergedAt: at(pr.mergedAfter),
                baseRefName: "master",
                headRefName: pr.head,
                author: { login: "grimfeld", __typename: "User" },
                closingIssuesReferences: { nodes: pr.closes.map((number) => ({ number, repository: { nameWithOwner: "grimfeld/lifeline" } })) },
                commits: { nodes: pr.commitsAt.map((hours) => ({ commit: { messageHeadline: "Work", authoredDate: at(hours) } })) },
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

/** A session on `branch` with a line at each of `linesAt`; a sub-agent's when `agentId` is set. */
function session(id: string, branch: string, linesAt: number[], agentId?: string): TranscriptFile {
  return {
    session: id,
    ...(agentId === undefined ? {} : { agentId }),
    lines: linesAt.map((hours, index) => ({
      type: index % 2 === 0 ? "assistant" : "user",
      sessionId: id,
      uuid: `${id}-${agentId ?? "main"}-${String(index)}`,
      timestamp: at(hours),
      gitBranch: branch,
      cwd: "/Users/dev/repos/lifeline",
      ...(index % 2 === 0 ? {} : { toolUseResult: {} }),
    })),
  };
}

interface Dataset {
  metrics: Record<string, { value: unknown; coverage: { tickets: number; of: number } }>;
}

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-activity-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

async function collect(github: GitHubSource, transcripts: TranscriptFile[] = [], args: string[] = []): Promise<Dataset> {
  const source: TranscriptSource = { read: () => Promise.resolve(transcripts) };
  const status = await main(["collect", ...args], { cwd, github, transcripts: source, now: () => NOW, stdout: () => undefined, stderr: (text) => assert.fail(text) });
  assert.equal(status, 0);
  const repo = github === BATCH_SOURCE ? "grimfeld/agentic-metrics" : "grimfeld/lifeline";
  return JSON.parse(readFileSync(join(cwd, "datasets", `${repo}.json`), "utf8")) as Dataset;
}

const BATCH_SOURCE = fixtureSource(BATCH);

interface LeadRow {
  ticket: string;
  hours: number;
  queueHours?: number;
  workHours?: number;
  landingHours?: number;
}

function leadRows(dataset: Dataset): LeadRow[] {
  return (dataset.metrics["leadTime"]?.value as { tickets: LeadRow[] }).tickets;
}

describe("lead time phases", () => {
  it("splits a ticket's lead time into queue, work and landing wait, which add up to it", async () => {
    // Ready at 02:00, commits at 05:00 and 06:00, merged at 10:00.
    const dataset = await collect(fakeGitHub([{ number: 1, ready: 2 }], [{ number: 10, head: "ticket-1", closes: [1], openedAfter: 6, mergedAfter: 10, commitsAt: [5, 6] }]));

    assert.deepEqual(leadRows(dataset), [{ ticket: "#1", hours: 8, queueHours: 3, workHours: 1, landingHours: 4 }]);
  });

  it("gives a queue of 0, not a negative one, to a ticket worked on before it was ready", async () => {
    // Commits at 01:00 and 05:00, labelled ready at 03:00, merged at 07:00: its
    // lead time is 4 h, of which the work phase is what followed the label.
    const dataset = await collect(fakeGitHub([{ number: 1, ready: 3 }], [{ number: 10, head: "ticket-1", closes: [1], openedAfter: 5, mergedAfter: 7, commitsAt: [1, 5] }]));

    assert.deepEqual(leadRows(dataset), [{ ticket: "#1", hours: 4, queueHours: 0, workHours: 2, landingHours: 2 }]);
  });

  it("counts the days a finished ticket waited to be merged as landing wait", async () => {
    // Written in an hour, merged 16 days later.
    const dataset = await collect(fakeGitHub([{ number: 1, ready: 0 }], [{ number: 10, head: "ticket-1", closes: [1], openedAfter: 2, mergedAfter: 386, commitsAt: [1, 2] }]));

    assert.deepEqual(leadRows(dataset), [{ ticket: "#1", hours: 386, queueHours: 1, workHours: 1, landingHours: 384 }]);
    assert.deepEqual((dataset.metrics["leadTime"]?.value as { phases: unknown }).phases, {
      tickets: 1,
      queue: { p50Hours: 1, share: 0.003 },
      work: { p50Hours: 1, share: 0.003 },
      landing: { p50Hours: 384, share: 0.995 },
    });
  });

  it("reads activity from the ticket's sessions as well as its commits", async () => {
    // One commit at 06:00; its session ran from 04:00 to 06:30 (lines every 3 minutes).
    const lines = Array.from({ length: 51 }, (_, index) => 4 + index * 0.05);
    const dataset = await collect(
      fakeGitHub([{ number: 1, ready: 2 }], [{ number: 10, head: "ticket-1", closes: [1], openedAfter: 6, mergedAfter: 10, commitsAt: [6] }]),
      [session("s1", "ticket-1", lines)],
    );

    assert.deepEqual(leadRows(dataset), [{ ticket: "#1", hours: 8, queueHours: 2, workHours: 2.5, landingHours: 3.5 }]);
  });

  it("ignores a session's activity after the ticket was delivered", async () => {
    // The session went on for a day after the merge at 10:00.
    const dataset = await collect(
      fakeGitHub([{ number: 1, ready: 2 }], [{ number: 10, head: "ticket-1", closes: [1], openedAfter: 6, mergedAfter: 10, commitsAt: [6] }]),
      [session("s1", "ticket-1", [5, 5.05, 30, 30.05])],
    );

    assert.deepEqual(leadRows(dataset), [{ ticket: "#1", hours: 8, queueHours: 3, workHours: 1, landingHours: 4 }]);
  });

  it("keeps the lead time of a ticket with no dated activity, with unknown phases", async () => {
    const github = fakeGitHub([{ number: 1, ready: 2 }], [{ number: 10, head: "ticket-1", closes: [1], openedAfter: 6, mergedAfter: 10, commitsAt: [] }]);
    const dataset = await collect(github);

    assert.deepEqual(dataset.metrics["leadTime"], { value: { p50Hours: 8, p90Hours: 8, tickets: [{ ticket: "#1", hours: 8 }] }, coverage: { tickets: 1, of: 1 } });
  });

  // The batch fixture: five tickets ready at the same time and landed by one
  // integration PR, so all five have a lead time of 120 h.
  it("ends a batched ticket's work at its own last commit: the wait for the batch is landing wait", async () => {
    const rows = leadRows(await collect(BATCH_SOURCE));

    assert.deepEqual([...new Set(rows.map((row) => row.hours))], [120]);
    assert.deepEqual(
      rows.map((row) => [row.ticket, row.queueHours, row.workHours, row.landingHours]),
      [
        ["#19", 72, 0, 48],
        // Its commits ran from 10:00 to 11:00 on the first day; the merge into the batch an hour later is not work.
        ["#2", 25, 1, 94],
        ["#16", 49, 0, 71],
        ["#17", 74, 1, 45],
        ["#18", 48, 0, 72],
      ],
    );
  });

  it("keeps the phases' aggregates, and no ticket, in an anonymized dataset", async () => {
    writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify({ publish: "anonymized", alias: "client-a" }));
    const github = fakeGitHub([{ number: 1, ready: 2 }], [{ number: 10, head: "ticket-1", closes: [1], openedAfter: 6, mergedAfter: 10, commitsAt: [5, 6] }]);
    const status = await main(["collect"], { cwd, github, now: () => NOW, stdout: () => undefined });
    assert.equal(status, 0);
    const dataset = JSON.parse(readFileSync(join(cwd, "datasets/client-a.json"), "utf8")) as Dataset;

    assert.deepEqual(dataset.metrics["leadTime"]?.value, {
      p50Hours: 8,
      p90Hours: 8,
      phases: { tickets: 1, queue: { p50Hours: 3, share: 0.375 }, work: { p50Hours: 1, share: 0.125 }, landing: { p50Hours: 4, share: 0.5 } },
    });
  });
});
