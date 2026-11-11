// The kind of change of a ticket, from its kind:* labels, and each metric by kind.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { kindOf } from "../../cli/conventions.ts";
import { size } from "../../cli/metrics/size.ts";
import { anonymizeByKind, byKind as compareByKind } from "../../cli/trends.ts";
import { findGaps } from "../../cli/gaps.ts";
import type { GitHubData } from "../../cli/github/load.ts";
import type { LinkedWork, Ticket } from "../../cli/linker.ts";
import { readConfig } from "../../cli/config.ts";
import { tmpdir } from "node:os";

describe("kind of change", () => {
  it("reads it from the issue's labels, else its PRs'", () => {
    assert.equal(kindOf(["kind:fix"], ["kind:feature"]), "fix");
    assert.equal(kindOf([], ["Kind:Refactor"]), "refactor");
    assert.equal(kindOf(undefined, []), "unknown");
    assert.equal(kindOf(["kind:fix", "kind:docs"], []), "conflicting");
    assert.equal(kindOf(["kind:nonsense"], []), "unknown");
  });

  const ticket = (id: string, labels: string[]) =>
    ({ id, issue: { labels, labelled: [] }, sessions: [], pullRequests: [{ labels: [], commits: [], filesComplete: true, number: 1, additions: 1, deletions: 0, files: [] }], integrationPullRequests: [], batchCommits: [], doneAt: new Date("2026-11-01T00:00:00Z") }) as unknown as Ticket;
  const work = (tickets: Ticket[]) =>
    ({ tickets, pullRequests: tickets.flatMap((t) => t.pullRequests), integrationPullRequests: [], regressions: [], ci: { defaultBranch: "main", mainWorkflow: undefined, runs: [] }, transcripts: { sessions: 0, orchestration: [] } }) as unknown as LinkedWork;
  const sizeByKind = (tickets: Ticket[]) => compareByKind(work(tickets), [size], (_metric, value) => value)["size"];

  it("puts a ticket with no kind under unknown, and one with two kinds under neither, in a gap", () => {
    const tickets = [ticket("#1", ["kind:fix"]), ticket("#2", []), ticket("#3", ["kind:fix", "kind:docs"])];
    const byKind = sizeByKind(tickets);
    const data = { actionRuns: [{ createdAt: new Date(), conclusion: "success" }], regressions: [{}] } as unknown as GitHubData;
    const gap = findGaps({ work: work(tickets), data, config: readConfig(tmpdir()), checkout: undefined }).find((g) => g.id === "conflicting-kinds");

    assert.ok(byKind);
    assert.equal(byKind.fix.coverage.of, 1);
    assert.equal(byKind.unknown.coverage.of, 1);
    assert.equal(byKind.docs.coverage.of, 0);
    assert.deepEqual(gap?.ticketIds, ["#3"]);
  });

  it("withholds a kind's figure over 2 tickets in an anonymized dataset", () => {
    const tickets = [ticket("#1", ["kind:fix"]), ticket("#2", ["kind:fix"]), ...[3, 4, 5].map((n) => ticket(`#${String(n)}`, ["kind:feature"]))];
    const byKind = anonymizeByKind({ size: sizeByKind(tickets) ?? ({} as never) })["size"];

    assert.ok(byKind);
    assert.equal(byKind.fix.value, "suppressed");
    assert.equal(typeof byKind.feature.value, "number");
  });
});
