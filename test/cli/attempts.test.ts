// Abandoned pull requests, attempts per ticket, and undelivered work.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";

const LIFELINE = join(import.meta.dirname, "../fixtures/github/lifeline");

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-attempts-"));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const closed = (number: number, closes: number[], branch = `try-${String(number)}`) => ({
  number,
  createdAt: "2026-10-18T09:00:00Z",
  updatedAt: "2026-10-18T10:00:00Z",
  closedAt: "2026-10-18T10:00:00Z",
  baseRefName: "master",
  headRefName: branch,
  author: { login: "grimfeld", __typename: "User" },
  closingIssuesReferences: { nodes: closes.map((n) => ({ number: n, repository: { nameWithOwner: "grimfeld/lifeline" } })) },
  commits: { nodes: [] },
});

/** Lifeline's history with these PRs closed without merging. */
async function metrics(abandoned: unknown[]) {
  const fixture = join(cwd, "fixture");
  cpSync(LIFELINE, fixture, { recursive: true });
  writeFileSync(join(fixture, "closed-pull-requests.json"), JSON.stringify([{ data: { repository: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: abandoned } } } }]));
  const out = join(cwd, "out");
  rmSync(out, { recursive: true, force: true });
  assert.equal(await main(["collect", "--datasets", out], { cwd, github: fixtureSource(fixture), stdout: () => {} }), 0);
  return (JSON.parse(readFileSync(join(out, "grimfeld/lifeline.json"), "utf8")) as { metrics: Record<string, { value: Record<string, unknown> }> }).metrics;
}

describe("attempts", () => {
  it("counts an abandoned and a merged PR as 2 attempts on the ticket", async () => {
    const value = (await metrics([closed(200, [104])]))["attempts"]?.value;

    assert.deepEqual((value?.["perTicket"] as { ticket: string; attempts: number }[]).find((row) => row.ticket === "#104"), { ticket: "#104", attempts: 2, abandoned: 1 });
    assert.equal(value?.["retried"], 1);
  });

  it("links an abandoned PR through its branch name too", async () => {
    const value = (await metrics([{ ...closed(201, []), headRefName: "106-second-go" }]))["attempts"]?.value;

    assert.equal((value?.["perTicket"] as { ticket: string; abandoned: number }[]).find((row) => row.ticket === "#106")?.abandoned, 1);
  });

  it("counts an issue with only abandoned PRs as undelivered work, not a ticket", async () => {
    // #107's only merged PR targets a feature branch: it is not delivered.
    const value = (await metrics([closed(202, [107])]))["attempts"]?.value;

    assert.ok(value);
    assert.equal(value["undelivered"], 1);
    assert.equal((value["perTicket"] as unknown[]).length, 5);
  });

  it("changes neither throughput nor lead time", async () => {
    const before = await metrics([]);
    const after = await metrics([closed(200, [104]), closed(202, [107])]);

    assert.deepEqual(after["throughput"], before["throughput"]);
    assert.deepEqual(after["leadTime"], before["leadTime"]);
  });
});
