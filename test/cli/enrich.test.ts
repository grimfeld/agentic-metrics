// On-demand enrichment: the context the skill reads, and writing only what was accepted.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyAccepted, type EnrichContext, type GitHubWriter } from "../../cli/enrich.ts";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";

function recording(): { writer: GitHubWriter; writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    writer: {
      addLabel: (number, label) => Promise.resolve(void writes.push(`label #${String(number)} ${label}`)),
      comment: (issue, body) => Promise.resolve(void writes.push(`comment #${String(issue)} ${body}`)),
      appendToPullRequestBody: (pr, text) => Promise.resolve(void writes.push(`body #${String(pr)} ${text}`)),
    },
  };
}

const context: EnrichContext = {
  ticket: "#50",
  issue: 50,
  pullRequests: [60],
  kind: "unknown",
  bugFix: true,
  declaredCauses: [],
  candidates: [{ ticket: "#31", pullRequest: 60, how: "blame" }],
  unlinkedPullRequests: [],
  kinds: ["feature", "fix", "refactor", "chore", "docs", "test"],
};

describe("enrich: applying", () => {
  it("writes the accepted proposals as conventions", async () => {
    const { writer, writes } = recording();
    await applyAccepted(context, { kind: "fix", causedBy: 31 }, writer);

    assert.deepEqual(writes, ["label #50 kind:fix", "comment #50 caused-by: #31", "label #50 regression"]);
  });

  it("writes nothing when every proposal was rejected", async () => {
    const { writer, writes } = recording();
    assert.deepEqual(await applyAccepted(context, {}, writer), ["nothing accepted: nothing written"]);
    assert.deepEqual(writes, []);
  });

  it("refuses a cause tracing did not find, and writes nothing", async () => {
    const { writer, writes } = recording();
    await assert.rejects(applyAccepted(context, { kind: "fix", causedBy: 7 }, writer), /not a cause tracing found/);
    assert.deepEqual(writes, []);
  });

  it("adds Closes to an unlinked PR only", async () => {
    const { writer, writes } = recording();
    const unlinked = { ...context, ticket: "PR #136", issue: undefined, pullRequests: [136], unlinkedPullRequests: [136], bugFix: false, candidates: [] };
    await applyAccepted(unlinked, { closes: { pullRequest: 136, issue: 104 } }, writer);
    await assert.rejects(applyAccepted(unlinked, { closes: { pullRequest: 999, issue: 104 } }, writer));

    assert.deepEqual(writes, ["body #136 Closes #104"]);
  });
});

describe("enrich: context", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "am-enrich-"));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("gives a ticket's kind, links and candidates as JSON", async () => {
    let out = "";
    const status = await main(["enrich-context", "#136"], { cwd, github: fixtureSource(join(import.meta.dirname, "../fixtures/github/lifeline")), stdout: (text) => (out += text) });
    assert.equal(status, 0);
    const parsed = JSON.parse(out) as EnrichContext;

    assert.equal(parsed.ticket, "PR #136");
    assert.equal(parsed.kind, "unknown");
    assert.deepEqual(parsed.unlinkedPullRequests, [136]);
  });

  it("apply writes nothing without an acceptance", async () => {
    const { writer, writes } = recording();
    const status = await main(["enrich-apply", "104"], { cwd, writer, github: fixtureSource(join(import.meta.dirname, "../fixtures/github/lifeline")), stdout: () => {} });

    assert.equal(status, 0);
    assert.deepEqual(writes, []);
  });
});
