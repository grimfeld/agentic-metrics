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

const REGRESSION_QUESTION =
  "Regression? Reply `caused-by: #N` naming the ticket or PR that introduced it. <!-- agentic-metrics:regression-question -->";

describe("Action: regression question on the bug label", () => {
  it("asks whether a newly labelled bug is a regression", () => {
    const operations = decide({ name: "issues", payload: fixture("issues-labeled-bug.json"), comments: [] });

    assert.deepEqual(operations, [
      { kind: "create-issue-comment", owner: "grimfeld", repo: "lifeline", issueNumber: 402, body: REGRESSION_QUESTION },
    ]);
  });

  it("does not ask again when the question is already on the issue", () => {
    const comments = [{ body: "Seen on Safari too." }, { body: REGRESSION_QUESTION }];

    assert.deepEqual(decide({ name: "issues", payload: fixture("issues-labeled-bug.json"), comments }), []);
  });

  it("does not ask when the bug already names its cause", () => {
    const comments = [{ body: "Found it.\ncaused-by: #376" }];

    assert.deepEqual(decide({ name: "issues", payload: fixture("issues-labeled-bug.json"), comments }), []);
  });

  it("still asks when the only caused-by names another repo, which cannot be traced", () => {
    const comments = [{ body: "caused-by: grimfeld/other#376" }];

    assert.equal(decide({ name: "issues", payload: fixture("issues-labeled-bug.json"), comments }).length, 1);
  });

  it("uses the repo's bug label when one is given", () => {
    const payload = withLabel(fixture("issues-labeled-bug.json"), "type: bug");

    assert.equal(decide({ name: "issues", payload, comments: [] }, { bugLabel: "Type: Bug" }).length, 1);
    assert.deepEqual(decide({ name: "issues", payload: fixture("issues-labeled-bug.json"), comments: [] }, { bugLabel: "type: bug" }), []);
  });

  it("ignores a bug label added to a pull request", () => {
    const payload = fixture("issues-labeled-bug.json");
    (payload["issue"] as Record<string, unknown>)["pull_request"] = { url: "https://api.github.com/repos/grimfeld/lifeline/pulls/402" };

    assert.deepEqual(decide({ name: "issues", payload, comments: [] }), []);
  });

  it("ignores other labels and other issue actions", () => {
    const enhancement = withLabel(fixture("issues-labeled-bug.json"), "enhancement");
    const unlabeled = { ...fixture("issues-labeled-bug.json"), action: "unlabeled" };

    assert.deepEqual(decide({ name: "issues", payload: enhancement, comments: [] }), []);
    assert.deepEqual(decide({ name: "issues", payload: unlabeled, comments: [] }), []);
  });
});

const ESTIMATE_REMINDER =
  "No estimate yet: reply `estimate: 2d` (h, d or w) before work starts, if you have one. <!-- agentic-metrics:estimate-reminder -->";

describe("Action: estimate reminder on the ready label", () => {
  it("reminds about an estimate when a ticket without one becomes ready", () => {
    const comments = [{ body: "Context from #394: shelves are per user." }];

    const operations = decide({ name: "issues", payload: fixture("issues-labeled-ready.json"), comments });

    assert.deepEqual(operations, [
      { kind: "create-issue-comment", owner: "grimfeld", repo: "lifeline", issueNumber: 376, body: ESTIMATE_REMINDER },
    ]);
  });

  for (const estimate of ["estimate: 2d", "Estimate: 4h", "Looked at it.\nestimate: 1w"]) {
    it(`stays quiet when the ticket already has an estimate (${JSON.stringify(estimate)})`, () => {
      const comments = [{ body: "Context from #394." }, { body: estimate }];

      assert.deepEqual(decide({ name: "issues", payload: fixture("issues-labeled-ready.json"), comments }), []);
    });
  }

  it("does not remind again when the reminder is already on the issue", () => {
    const comments = [{ body: ESTIMATE_REMINDER }];

    assert.deepEqual(decide({ name: "issues", payload: fixture("issues-labeled-ready.json"), comments }), []);
  });

  it("uses the repo's ready label when one is given", () => {
    const payload = withLabel(fixture("issues-labeled-ready.json"), "ready");

    assert.equal(decide({ name: "issues", payload, comments: [] }, { readyLabel: "ready" }).length, 1);
    assert.deepEqual(decide({ name: "issues", payload: fixture("issues-labeled-ready.json"), comments: [] }, { readyLabel: "ready" }), []);
  });
});

function withLabel(payload: Record<string, unknown>, name: string): Record<string, unknown> {
  payload["label"] = { name };
  return payload;
}

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
