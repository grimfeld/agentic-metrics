// Conventions inferred from history, for those a repo's config doesn't set.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHubData, Issue, PullRequest } from "../../cli/github/load.ts";
import { inferConventions } from "../../cli/infer.ts";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";
import type { RepoAdmin } from "../../cli/init.ts";

const day = (n: number) => new Date(Date.UTC(2026, 9, n));

function pr(number: number, branch: string, closes: number[], opened = day(10)): PullRequest {
  return { number, headRefName: branch, baseRefName: "main", closes, createdAt: opened, commits: [] } as unknown as PullRequest;
}

function issue(number: number, labelled: [string, Date][] = [], labels: string[] = []): Issue {
  return { number, labelled: labelled.map(([label, at]) => ({ label, at })), labels } as unknown as Issue;
}

function data(pullRequests: PullRequest[], issues: Issue[]): GitHubData {
  return { repo: { defaultBranch: "main" }, pullRequests, issues } as unknown as GitHubData;
}

describe("inferred conventions", () => {
  it("takes the label most issues got before their first PR as the ready label", () => {
    const history = data(
      [pr(1, "a", [11]), pr(2, "b", [12]), pr(3, "c", [13]), pr(4, "d", [14])],
      [issue(11, [["triage-done", day(1)]]), issue(12, [["triage-done", day(2)]]), issue(13, [["triage-done", day(3)], ["bug", day(3)]]), issue(14, [["triage-done", day(20)]])],
    );

    assert.equal(inferConventions(history, new Set()).readyLabel, "triage-done");
  });

  it("infers no ready label without a clear one, nor while the default is in use", () => {
    const scattered = data([pr(1, "a", [11]), pr(2, "b", [12]), pr(3, "c", [13])], [issue(11, [["x", day(1)]]), issue(12, [["y", day(1)]]), issue(13)]);
    const usingDefault = data(
      [pr(1, "a", [11]), pr(2, "b", [12]), pr(3, "c", [13])],
      [issue(11, [["triage-done", day(1)]]), issue(12, [["triage-done", day(1)]]), issue(13, [["triage-done", day(1)], ["ready-for-agent", day(2)]])],
    );

    assert.equal(inferConventions(scattered, new Set()).readyLabel, undefined);
    assert.equal(inferConventions(usingDefault, new Set()).readyLabel, undefined);
  });

  it("finds a branch pattern the default misses, when it names the right issue", () => {
    const history = data([pr(1, "story_41-login", [41]), pr(2, "story_42", [42]), pr(3, "dev/story_43-x", [43])], []);

    const { branchRegex } = inferConventions(history, new Set());
    assert.ok(branchRegex);
    assert.equal(new RegExp(branchRegex, "i").exec("story_44-y")?.[1], "44");
  });

  it("keeps the default branch pattern when it already finds the issues", () => {
    const history = data([pr(1, "41-login", [41]), pr(2, "spec-42-x", [42])], []);

    assert.equal(inferConventions(history, new Set()).branchRegex, undefined);
  });

  it("takes a bug-like label when `bug` is not used", () => {
    assert.equal(inferConventions(data([], [issue(1, [], ["type: defect"]), issue(2, [], ["type: defect"]), issue(3, [], ["enhancement"])]), new Set()).bugLabel, "type: defect");
    assert.equal(inferConventions(data([], [issue(1, [], ["bug"])]), new Set()).bugLabel, undefined);
  });

  it("infers nothing for a field the config sets", () => {
    const history = data(
      [pr(1, "story_41", [41]), pr(2, "story_42", [42]), pr(3, "story_43", [43])],
      [issue(41, [["triage-done", day(1)]], ["type: defect"]), issue(42, [["triage-done", day(1)]]), issue(43, [["triage-done", day(1)]])],
    );

    assert.deepEqual(inferConventions(history, new Set(["readyLabel", "branchRegex", "bugLabel"])), { usesIssues: true });
  });

  it("says when no PR closes an issue: every PR is then its own ticket", () => {
    assert.equal(inferConventions(data([pr(1, "a", [])], []), new Set()).usesIssues, false);
  });

  it("gives the same answer for the same history", () => {
    const history = data([pr(1, "story_41", [41]), pr(2, "story_42", [42])], [issue(1, [], ["defect"]), issue(2, [], ["bug report"])]);

    assert.deepEqual(inferConventions(history, new Set()), inferConventions(history, new Set()));
  });
});

describe("inferred conventions: gaps and init", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "am-infer-"));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  const FIXTURES = join(import.meta.dirname, "../fixtures/github");

  /** The lifeline fixture with every PR that closes an issue on a `story_N` branch, which the default pattern misses. */
  function storyBranches(): string {
    const fixture = mkdtempSync(join(tmpdir(), "am-infer-fixture-"));
    for (const file of ["repo", "issues", "regressions", "workflow-runs", "closed-pull-requests"]) writeFileSync(join(fixture, `${file}.json`), readFileSync(join(FIXTURES, "lifeline", `${file}.json`)));
    const prs = JSON.parse(readFileSync(join(FIXTURES, "lifeline", "pull-requests.json"), "utf8")) as { data: { repository: { pullRequests: { nodes: { headRefName: string; closingIssuesReferences: { nodes: { number: number }[] } }[] } } } }[];
    for (const page of prs) {
      for (const node of page.data.repository.pullRequests.nodes) {
        const closes = node.closingIssuesReferences.nodes[0]?.number;
        if (closes !== undefined) node.headRefName = `story_${String(closes)}`;
      }
    }
    writeFileSync(join(fixture, "pull-requests.json"), JSON.stringify(prs));
    return fixture;
  }

  it("shows an inferred convention as a gap whose fix is init", async () => {
    const fixture = storyBranches();
    try {
      assert.equal(await main(["collect"], { cwd, github: fixtureSource(fixture), stdout: () => {} }), 0);
      const gaps = (JSON.parse(readFileSync(join(cwd, "datasets/grimfeld/lifeline.json"), "utf8")) as { gaps: { id: string; cause: string; fix: { command?: string } }[] }).gaps;
      const gap = gaps.find((g) => g.id === "inferred-branchRegex");

      assert.ok(gap);
      assert.match(gap.cause, /story_/);
      assert.match(gap.fix.command ?? "", /^npx agentic-metrics init/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  function admin(): RepoAdmin {
    return {
      repo: () => Promise.resolve({ fullName: "grimfeld/lifeline", private: false }),
      labels: () => Promise.resolve(["regression", "autonomy:full", "autonomy:assisted", "autonomy:manual"]),
      createLabel: () => Promise.resolve(),
      actionsPolicy: () => Promise.resolve({ allowedActions: "all", patternsAllowed: [], shaPinningRequired: false }),
      commitSha: () => Promise.resolve("a".repeat(40)),
    };
  }

  it("lets init write an inferred value into a config that lacks the field, and never change one set", async () => {
    writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify({ readyLabel: "mine" }));
    const fixture = storyBranches();
    try {

      let out = "";
      const status = await main(["init"], { cwd, admin: admin(), github: fixtureSource(fixture), version: "9.9.9", stdout: (text) => (out += text) });
      assert.equal(status, 0, out);
      const file = JSON.parse(readFileSync(join(cwd, ".agentic-metrics.json"), "utf8")) as Record<string, unknown>;

      assert.equal(file["readyLabel"], "mine");
      assert.match(String(file["branchRegex"]), /story_/);
      assert.match(out, /kept, with branchRegex added; inferred from history/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
