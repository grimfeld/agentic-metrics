import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decide } from "../../action/decide.ts";

const FIXTURES = join(import.meta.dirname, "../fixtures/action");

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;
}

describe("Action: Closes #N from the branch name", () => {
  it("adds Closes #N to a PR whose description has no issue reference", () => {
    const operations = decide({ name: "pull_request", payload: fixture("pull-request-opened.json") });

    assert.deepEqual(operations, [
      {
        kind: "update-pr-body",
        owner: "grimfeld",
        repo: "lifeline",
        pullNumber: 380,
        body: "Adds shelf filters to the library view.\n\nCloses #376 <!-- agentic-metrics:closes -->",
      },
    ]);
  });

  it("leaves a description that already references an issue untouched", () => {
    const operations = decide({ name: "pull_request", payload: fixture("pull-request-edited-linked.json") });

    assert.deepEqual(operations, []);
  });

  it("does nothing when the branch name carries no issue number", () => {
    const operations = decide({ name: "pull_request", payload: fixture("pull-request-opened-no-number.json") });

    assert.deepEqual(operations, []);
  });

  for (const body of [
    "Part of grimfeld/lifeline#12",
    "Fixes #12",
    "See https://github.com/grimfeld/lifeline/issues/12",
    "Follow-up to #12.",
  ]) {
    it(`treats ${JSON.stringify(body)} as already referencing an issue`, () => {
      assert.deepEqual(decide({ name: "pull_request", payload: withBody(body) }), []);
    });
  }

  it("does not mistake an HTML entity for an issue reference", () => {
    const [operation] = decide({ name: "pull_request", payload: withBody("Tom &#38; Jerry") });

    assert.equal(operation?.body, "Tom &#38; Jerry\n\nCloses #376 <!-- agentic-metrics:closes -->");
  });

  it("writes only the Closes line when the description is empty", () => {
    const [operation] = decide({ name: "pull_request", payload: withBody(null) });

    assert.equal(operation?.body, "Closes #376 <!-- agentic-metrics:closes -->");
  });

  it("does not add a second line once its own Closes line is there", () => {
    const [first] = decide({ name: "pull_request", payload: fixture("pull-request-opened.json") });
    const rerun = decide({ name: "pull_request", payload: withBody(first?.body ?? "", "edited") });

    assert.deepEqual(rerun, []);
  });

  for (const [branch, issue] of [
    ["spec/363-reader-fixes", 363],
    ["ticket-16", 16],
    ["16-github-action-skeleton", 16],
    ["grimfeld/issue-42-typo", 42],
  ] as const) {
    it(`reads #${String(issue)} from the default branch pattern in ${branch}`, () => {
      const [operation] = decide({ name: "pull_request", payload: withBranch(branch) });

      assert.equal(operation?.body.endsWith(`Closes #${String(issue)} <!-- agentic-metrics:closes -->`), true);
    });
  }

  for (const branch of ["integration/2026-11-02", "dependabot/npm_and_yarn/vite-7.1.5", "main", "release-2"]) {
    it(`finds no issue number in ${branch} with the default pattern`, () => {
      assert.deepEqual(decide({ name: "pull_request", payload: withBranch(branch) }), []);
    });
  }

  it("uses the repo's branch pattern when one is given", () => {
    const options = { branchRegex: /^wip\/(\d+)/ };

    const [operation] = decide({ name: "pull_request", payload: withBranch("wip/88") }, options);
    const none = decide({ name: "pull_request", payload: fixture("pull-request-opened.json") }, options);

    assert.equal(operation?.body.endsWith("Closes #88 <!-- agentic-metrics:closes -->"), true);
    assert.deepEqual(none, []);
  });

  it("skips a PR from a fork, whose token cannot edit it", () => {
    const payload = fixture("pull-request-opened.json");
    const pr = payload["pull_request"] as { head: { repo: { full_name: string } } };
    pr.head.repo.full_name = "someone/lifeline";

    assert.deepEqual(decide({ name: "pull_request", payload }), []);
  });

  it("ignores other pull_request actions and other events", () => {
    const closed = { ...fixture("pull-request-opened.json"), action: "closed" };

    assert.deepEqual(decide({ name: "pull_request", payload: closed }), []);
    assert.deepEqual(decide({ name: "push", payload: fixture("pull-request-opened.json") }), []);
  });
});

function withBody(body: string | null, action = "opened"): Record<string, unknown> {
  const payload = fixture("pull-request-opened.json");
  (payload["pull_request"] as { body: string | null }).body = body;
  payload["action"] = action;
  return payload;
}

function withBranch(branch: string): Record<string, unknown> {
  const payload = fixture("pull-request-opened.json");
  (payload["pull_request"] as { head: { ref: string } }).head.ref = branch;
  return payload;
}
