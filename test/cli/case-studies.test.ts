import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";
import { transcriptCache } from "../../cli/transcripts/source.ts";
import { readAllPages } from "./report-pages.ts";

const GITHUB = join(import.meta.dirname, "../fixtures/github");
const CACHE = join(import.meta.dirname, "../fixtures/transcript-cache/lifeline");
const NOW = new Date("2026-11-09T12:00:00Z");

// The Lifeline fixture's delivered tickets, by diff (lines added + deleted):
//   #104 and #105 (PR #115): 120 + 30 = 150, 3 human messages each;
//   #106 (PRs #116, #117):  60 + 110 = 170, 1 human message, 50 net lines removed;
//      PR #116 ends with a "Notable intervention" line;
//   PR #136: 200 + 5 = 205, no transcript;
//   PR #137: 5 + 0 = 5, 2 human messages.
// Regressions: #141 (caused by #104) is closed as completed; #142 (PR #136)
// is closed as not planned; #140 and #145 (#106) are open.
const DRAFTS = "case-studies/grimfeld/lifeline";

let cwd: string;
let stderr: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-case-studies-"));
  stderr = "";
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

async function run(argv: string[]) {
  const status = await main(argv, {
    cwd,
    github: fixtureSource(join(GITHUB, "lifeline")),
    transcripts: transcriptCache({ dir: CACHE, repoDir: "/Users/dev/repos/lifeline" }),
    now: () => NOW,
    stdout: () => undefined,
    stderr: (text) => (stderr += text),
  });
  assert.equal(status, 0, stderr);
}

function config(fields: Record<string, unknown>) {
  writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify(fields));
}

function read(path: string): string {
  return readFileSync(join(cwd, path), "utf8");
}

function write(path: string, text: string) {
  mkdirSync(join(cwd, path, ".."), { recursive: true });
  writeFileSync(join(cwd, path), text);
}

function approve(path: string) {
  write(path, read(path).replace(/^approved: false$/m, "approved: true"));
}

/** Every page of the report. */
async function report(): Promise<string> {
  await run(["report"]);
  return readAllPages(join(cwd, "report"));
}

describe("case studies", () => {
  // In delivery order.
  it("flags candidates by the four criteria in a full dataset", async () => {
    await run(["collect"]);
    const dataset = JSON.parse(read("datasets/grimfeld/lifeline.json")) as { caseStudyCandidates: unknown };
    assert.deepEqual(dataset.caseStudyCandidates, [
      { ticket: "#104", criteria: ["regression caught and fixed"] },
      { ticket: "PR #136", criteria: ["largest ticket"] },
      { ticket: "#106", criteria: ["fewest human messages for its size", "largest deletion"] },
    ]);
  });

  it("writes an unapproved draft per candidate from its data, ticket and PR descriptions", async () => {
    await run(["collect"]);
    assert.deepEqual(readdirSync(join(cwd, DRAFTS)).sort(), ["104.md", "106.md", "pr-136.md"]);

    const draft = read(`${DRAFTS}/106.md`);
    assert.match(draft, /^---\napproved: false\n# Draft written by `agentic-metrics collect`\. Edit it, then set `approved: true` to publish it in the report\.\n---\n\n# #106 /);
    // The instruction lives in the front matter only, never in the story.
    assert.equal(draft.match(/Draft written by/g)?.length, 1);
    assert.match(draft, /^# #106 Lifeline issue title 106$/m);
    assert.match(draft, /fewest human messages for its size, largest deletion/);
    assert.match(draft, /170 lines changed \(60 added, 110 deleted\)/);
    assert.match(draft, /^- Human messages: 1$/m);
    assert.match(draft, /Field order is lost when a type is edited\./);
    assert.match(draft, /Rewrites the type editor's field list\./);
    assert.match(draft, /^Notable intervention: the human reverted the agent's schema change and kept the old field order\.$/m);

    const fixed = read(`${DRAFTS}/104.md`);
    assert.match(fixed, /^- Regressions: #141 \(fixed\)$/m);
    assert.match(read(`${DRAFTS}/pr-136.md`), /^- Human messages: unknown$/m);
    assert.doesNotMatch(read(`${DRAFTS}/pr-136.md`), /Notable intervention/);
  });

  it("never overwrites a draft that exists, edited or approved", async () => {
    write(`${DRAFTS}/106.md`, "---\napproved: true\n---\n\nMy own words.\n");
    await run(["collect"]);
    assert.equal(read(`${DRAFTS}/106.md`), "---\napproved: true\n---\n\nMy own words.\n");
  });

  it("renders approved case studies only", async () => {
    await run(["collect"]);
    approve(`${DRAFTS}/106.md`);
    const html = await report();
    assert.match(read("report/grimfeld--lifeline/index.html"), /<section class="card wide" data-section="case-studies"><h2>Case studies<\/h2><div class="studies"><a class="study-card" href="case-studies\/106\.html"><b>#106 Lifeline issue title 106<\/b><span class="muted">Case study #106<\/span><\/a><\/div>/);
    const page = read("report/grimfeld--lifeline/case-studies/106.html");
    assert.match(page, /<article class="case-study card" data-ticket="#106">/);
    assert.match(page, /<h4>#106 Lifeline issue title 106<\/h4>/);
    assert.match(page, /Notable intervention: the human reverted the agent&#39;s schema change/);
    assert.doesNotMatch(html, /data-ticket="#104"|data-ticket="PR #136"/);
    assert.deepEqual(readdirSync(join(cwd, "report/grimfeld--lifeline/case-studies")), ["106.html"]);
    // Drafts are not part of the published site.
    assert.equal(existsSync(join(cwd, "report/case-studies")), false);
  });

  it("leaves an older draft's instruction line off its page", async () => {
    await run(["collect"]);
    // Drafts written before the instruction moved to the front matter carry it in their story.
    write(
      `${DRAFTS}/106.md`,
      "---\napproved: true\n---\n\n# PR #88 Retire the Bible App\n\nDraft written by `agentic-metrics collect`. Edit it, then set `approved: true` above to publish it in the report.\n\nCandidate for: largest ticket.\n\nDraft written by hand is fine here.\n",
    );
    await run(["report"]);
    const page = read("report/grimfeld--lifeline/case-studies/106.html");
    assert.match(page, /<h4>PR #88 Retire the Bible App<\/h4>\n<p>Candidate for: largest ticket\.<\/p>/);
    assert.doesNotMatch(page, /agentic-metrics collect|approved: true/);
    assert.match(page, /<p>Draft written by hand is fine here\.<\/p>/);
  });

  it("renders an approved case study's Markdown as text, never as raw HTML", async () => {
    await run(["collect"]);
    write(`${DRAFTS}/106.md`, "---\napproved: true\n---\n\n# Title\n\n<script>alert(1)</script> and [a link](https://example.com/x)\n\n- one\n- two\n");
    const html = await report();
    assert.match(html, /<h4>Title<\/h4>/);
    assert.match(html, /<p>&#60;script&#62;alert\(1\)&#60;\/script&#62; and <a href="https:\/\/example\.com\/x">a link<\/a><\/p>/);
    assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  });

  it("renders **bold** and *emphasis*, leaving a lone asterisk and code alone", async () => {
    await run(["collect"]);
    write(`${DRAFTS}/106.md`, "---\napproved: true\n---\n\n**Door:** two-way, *soft* and __not bold__\n\n- **Before:** `a **b**` 2 * 3\n");
    await run(["report"]);
    const page = read("report/grimfeld--lifeline/case-studies/106.html");
    assert.match(page, /<p><strong>Door:<\/strong> two-way, <em>soft<\/em> and __not bold__<\/p>/);
    assert.match(page, /<li><strong>Before:<\/strong> <code>a \*\*b\*\*<\/code> 2 \* 3<\/li>/);
  });

  it("keeps a list item's indented continuation lines inside it, one per line", async () => {
    await run(["collect"]);
    write(`${DRAFTS}/106.md`, "---\napproved: true\n---\n\n- Migration on a copy:\n  Before: three\n  After: two\n- Typecheck clean\n\nAfter.\n");
    await run(["report"]);
    const page = read("report/grimfeld--lifeline/case-studies/106.html");
    assert.match(page, /<ul><li>Migration on a copy:<br>Before: three<br>After: two<\/li><li>Typecheck clean<\/li><\/ul>\n<p>After\.<\/p>/);
  });

  it("renders a fenced code block as code, keeping its language and its text", async () => {
    await run(["collect"]);
    write(
      `${DRAFTS}/106.md`,
      "---\napproved: true\n---\n\n## Summary\n\n```diff\n-apps/bible   (old <app>)\n+migration    body → Thought\n\n- not a list item\n# not a heading\n```\n\nAfter.\n\n```\nplain\n```\n",
    );
    await run(["report"]);
    const page = read("report/grimfeld--lifeline/case-studies/106.html");
    assert.match(
      page,
      /<pre><code class="language-diff">-apps\/bible {3}\(old &#60;app&#62;\)\n\+migration {4}body → Thought\n\n- not a list item\n# not a heading<\/code><\/pre>\n<p>After\.<\/p>\n<pre><code>plain<\/code><\/pre>/,
    );
  });

  it("renders an unclosed fence as code to the end of the story", async () => {
    await run(["collect"]);
    write(`${DRAFTS}/106.md`, "---\napproved: true\n---\n\nBefore.\n\n```ts\nconst a = 1;\n");
    await run(["report"]);
    assert.match(read("report/grimfeld--lifeline/case-studies/106.html"), /<p>Before\.<\/p>\n<pre><code class="language-ts">const a = 1;\n?<\/code><\/pre>/);
  });

  it("renders no case study while none is approved", async () => {
    await run(["collect"]);
    assert.doesNotMatch(await report(), /case-stud/);
  });

  it("writes no draft and renders no case study for an anonymized repo", async () => {
    config({ publish: "anonymized", alias: "side-project" });
    write("case-studies/side-project/106.md", "---\napproved: true\n---\n\n# Leak\n");
    await run(["collect"]);
    assert.equal(existsSync(join(cwd, "case-studies/grimfeld")), false);
    const dataset = JSON.parse(read("datasets/side-project.json")) as Record<string, unknown>;
    assert.equal("caseStudyCandidates" in dataset, false);
    const html = await report();
    assert.doesNotMatch(html, /case-stud|Leak/);
  });

  it("writes no draft and renders no case study for a none repo", async () => {
    config({ publish: "none" });
    write(`${DRAFTS}/106.md`, "---\napproved: true\n---\n\n# Leak\n");
    await run(["collect"]);
    assert.deepEqual(readdirSync(join(cwd, DRAFTS)), ["106.md"]);
    assert.doesNotMatch(readAllPages(join(cwd, ".agentic-metrics-local")), /case-stud|Leak/);
  });
});
