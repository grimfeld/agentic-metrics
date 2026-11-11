// Regressions inferred from reverts, shown apart from declared ones.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PullRequest, RegressionIssue } from "../../cli/github/load.ts";
import { revertRegressions } from "../../cli/inferred-regressions.ts";
import type { LinkedWork, Ticket } from "../../cli/linker.ts";
import { regressionRate } from "../../cli/metrics/regression-rate.ts";

const at = (day: number) => new Date(Date.UTC(2026, 9, day));

function pr(number: number, day: number, extra: { title?: string; body?: string; commits?: { oid: string; reverts?: string }[]; closes?: number[] } = {}): PullRequest {
  return { number, title: extra.title ?? `PR ${String(number)}`, body: extra.body ?? "", mergedAt: at(day), commits: extra.commits ?? [{ oid: `c${String(number)}` }], closes: extra.closes ?? [] } as unknown as PullRequest;
}

function work(prs: PullRequest[], regressions: RegressionIssue[] = []): LinkedWork {
  const tickets = prs.map((p) => ({ id: `PR #${String(p.number)}`, pullRequests: [p] }) as unknown as Ticket);
  return { tickets, pullRequests: prs, regressions } as unknown as LinkedWork;
}

describe("regressions inferred from reverts", () => {
  it("names the reverted PR's ticket as the cause, from GitHub's revert description", () => {
    const linked = work([pr(12, 1), pr(20, 5, { title: 'Revert "Add login"', body: "Reverts grimfeld/lifeline#12" })]);

    assert.deepEqual(
      revertRegressions(linked).map(({ cause, by, how }) => [cause.id, by.number, how]),
      [["PR #12", 20, "revert"]],
    );
  });

  it("names it from a commit's `This reverts commit` line too", () => {
    const linked = work([pr(12, 1, { commits: [{ oid: "abcdef1234567890" }] }), pr(20, 5, { commits: [{ oid: "x", reverts: "abcdef1" }] })]);

    assert.deepEqual(revertRegressions(linked).map(({ cause }) => cause.id), ["PR #12"]);
  });

  it("does not count reverting a revert as a regression of the original", () => {
    const linked = work([
      pr(12, 1),
      pr(20, 5, { title: 'Revert "Add login"', body: "Reverts grimfeld/lifeline#12" }),
      pr(21, 6, { title: 'Revert "Revert "Add login""', body: "Reverts grimfeld/lifeline#20" }),
    ]);

    assert.deepEqual(revertRegressions(linked).map(({ cause, by }) => [cause.id, by.number]), [["PR #12", 20]]);
  });

  it("is shown apart from declared regressions, and a regression both declared and inferred counts as declared only", () => {
    const linked = work(
      [pr(12, 1), pr(13, 2), pr(20, 5, { body: "Reverts grimfeld/lifeline#12", closes: [99] }), pr(21, 6, { body: "Reverts grimfeld/lifeline#13" })],
      [{ number: 99, causedBy: [12], fixed: true }],
    );
    const result = regressionRate.compute({ ...linked, inferredRegressions: revertRegressions(linked) });
    assert.notEqual(result.value, "unknown");
    if (result.value === "unknown") return;

    assert.equal(result.value.regressions, 1, "declared: #99 on PR #12");
    assert.deepEqual(result.value.inferred?.perTicket, [{ ticket: "PR #13", by: [{ pr: 21, how: "revert" }] }]);
    assert.equal(result.value.inferred.regressions, 1);
  });
});
