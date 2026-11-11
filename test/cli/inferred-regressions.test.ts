// Regressions inferred from reverts, shown apart from declared ones.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PullRequest, RegressionIssue } from "../../cli/github/load.ts";
import { blameReady, blameRegressions, revertRegressions } from "../../cli/inferred-regressions.ts";
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

describe("regressions inferred by blame", () => {
  let dir: string;
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" }).trim();
  /** Writes `file`, commits it, and returns the commit. */
  const commit = (file: string, text: string, message: string) => {
    writeFileSync(join(dir, file), text);
    git("add", file);
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const merged = (number: number, oid: string, day: number, extra: { title?: string; branch?: string } = {}) =>
    ({ number, title: extra.title ?? `PR ${String(number)}`, headRefName: extra.branch ?? `b${String(number)}`, body: "", closes: [], mergedAt: at(day), commits: [{ oid }], mergeCommitOid: oid }) as unknown as PullRequest;
  const blamed = (prs: PullRequest[], windowDays = 90) =>
    blameRegressions(work(prs), [], { dir, bugLabel: "bug", windowDays }).map(({ cause, by, how }) => [cause.id, by.number, how]);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "am-blame-"));
    git("init", "-q");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("names the PR that last touched the lines a fix changed", () => {
    const base = merged(1, commit("a.txt", "one\ntwo\nthree\n", "base"), 1);
    const feature = merged(2, commit("a.txt", "one\nTWO\nthree\n", "feature"), 5);
    const fix = merged(3, commit("a.txt", "one\n2\nthree\n", "fix: two"), 15, { title: "fix: two" });

    assert.deepEqual(blamed([base, feature, fix]), [["PR #2", 3, "blame"]]);
  });

  it("names none when those lines were last touched outside the window", () => {
    const feature = merged(2, commit("a.txt", "one\ntwo\n", "feature"), 1);
    const fix = merged(3, commit("a.txt", "one\n2\n", "fix"), 100, { branch: "fix/two" });

    assert.deepEqual(blamed([feature, fix], 90), []);
    assert.deepEqual(blamed([feature, fix], 120), [["PR #2", 3, "blame"]]);
  });

  it("never traces added lines", () => {
    const feature = merged(2, commit("a.txt", "one\n", "feature"), 1);
    const fix = merged(3, commit("a.txt", "one\nadded\n", "fix"), 5, { title: "fix: add a line" });

    assert.deepEqual(blamed([feature, fix]), []);
  });

  it("traces only bug fixes", () => {
    const feature = merged(2, commit("a.txt", "one\n", "feature"), 1);
    const change = merged(3, commit("a.txt", "uno\n", "change"), 5, { title: "Rename one" });

    assert.deepEqual(blamed([feature, change]), []);
  });

  it("says a shallow clone can't be traced", () => {
    commit("a.txt", "1\n", "one");
    commit("a.txt", "2\n", "two");
    const shallow = mkdtempSync(join(tmpdir(), "am-blame-shallow-"));
    try {
      execFileSync("git", ["clone", "-q", "--depth", "1", `file://${dir}`, shallow]);
      assert.equal(blameReady(shallow), "shallow");
      assert.equal(blameReady(dir), "ready");
      assert.equal(blameReady(tmpdir()), "no-clone");
    } finally {
      rmSync(shallow, { recursive: true, force: true });
    }
  });
});
