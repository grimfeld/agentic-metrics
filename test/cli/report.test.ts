import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";

const FIXTURES = join(import.meta.dirname, "../fixtures/github");
const NOW = new Date("2026-11-09T12:00:00Z");

let cwd: string;
let html: string;

async function run(argv: string[], fixture = "lifeline") {
  const status = await main(argv, { cwd, github: fixtureSource(join(FIXTURES, fixture)), now: () => NOW, stdout: () => undefined });
  assert.equal(status, 0);
}

before(async () => {
  cwd = mkdtempSync(join(tmpdir(), "am-report-"));
  await run(["collect"], "lifeline");
  await run(["collect"], "empty");
  await run(["report"]);
  html = readFileSync(join(cwd, "report/index.html"), "utf8");
});

after(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/** The visible text of the first element carrying `attribute="value"`, inside the repo's section when given. */
function textOf(attribute: string, value: string, repo?: string): string {
  const scope = repo ? section(repo) : html;
  const match = new RegExp(`<(\\w+)[^>]* ${attribute}="${value}"[^>]*>([\\s\\S]*?)</\\1>`).exec(scope);
  assert.ok(match, `no element with ${attribute}="${value}"`);
  return (match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function section(repo: string): string {
  const match = new RegExp(`<section class="repo"[^>]* data-repo="${repo}">([\\s\\S]*?)</section><!-- /repo -->`).exec(html);
  assert.ok(match, `no section for ${repo}`);
  return match[1] ?? "";
}

describe("report", () => {
  it("shows the four headline cards for each repo, in order", () => {
    const cards = [...section("grimfeld/lifeline").matchAll(/class="card" data-metric="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(cards, ["leadTime", "firstRunCiRate", "humanMessagesPerTicket", "regressionRate"]);
  });

  it("shows lead time p50 and p90 with its coverage", () => {
    assert.equal(textOf("data-metric", "leadTime", "grimfeld/lifeline"), "Lead time 12 h p50 · 7.5 d p90 5 of 5 tickets");
  });

  it("shows the first-run CI rate as unknown when no PR has a CI run", () => {
    assert.equal(textOf("data-metric", "firstRunCiRate", "grimfeld/lifeline"), "First-run CI rate unknown 0 of 5 tickets");
  });

  it("shows the regression rate on its card, with its coverage", () => {
    assert.equal(textOf("data-metric", "regressionRate", "grimfeld/lifeline"), "Regression rate 60% 4 regressions 5 of 5 tickets");
    assert.equal(textOf("data-metric", "regressionRate", "grimfeld/agentic-metrics"), "Regression rate unknown 0 of 0 tickets");
  });

  it("lists regressions per ticket, and the untraced ones", () => {
    assert.equal(
      textOf("data-section", "regressionRate", "grimfeld/lifeline"),
      "Regression rate Ticket Regressions #104 #141 PR #136 #142 #106 #140, #145 Untraced: #143, #144",
    );
  });

  it("defines regression rate in Methodology, with its coverage per repo", () => {
    const entry = textOf("data-methodology", "regressionRate");
    assert.match(entry, /^Regression rate The share of delivered tickets that caused at least one regression/);
    assert.match(entry, /Coverage: grimfeld\/agentic-metrics 0 of 0 tickets; grimfeld\/lifeline 5 of 5 tickets/);
  });

  it("shows a metric with no data as unknown, with its coverage", () => {
    assert.equal(textOf("data-metric", "leadTime", "grimfeld/agentic-metrics"), "Lead time unknown 0 of 0 tickets");
    assert.equal(textOf("data-metric", "humanMessagesPerTicket", "grimfeld/lifeline"), "Human messages per ticket unknown 0 of 5 tickets");
  });

  it("shows throughput per week", () => {
    assert.equal(
      textOf("data-section", "throughput", "grimfeld/lifeline"),
      "Throughput Week of Tickets PRs 2026-10-19 2 2 2026-10-26 2 2 2026-11-02 0 0 2026-11-09 1 1",
    );
  });

  it("defines each metric present in Methodology, with its coverage per repo", () => {
    const leadTime = textOf("data-methodology", "leadTime");
    assert.match(leadTime, /^Lead time Time from a ticket becoming ready to its last PR merging into the default branch/);
    assert.match(leadTime, /Coverage: grimfeld\/agentic-metrics 0 of 0 tickets; grimfeld\/lifeline 5 of 5 tickets/);
    assert.match(textOf("data-methodology", "throughput"), /^Throughput Tickets and pull requests delivered per week/);
  });

  it("shows the test ratio and net lines removed, with each ticket's lines", () => {
    assert.equal(
      textOf("data-section", "testRatio", "grimfeld/lifeline"),
      "Test lines per production line 0.59 test lines added per production line: 65 test lines for 110 production lines. " +
        "Ticket Test lines Production lines #104 30 80 #105 30 80 #106 30 30 PR #137 5 0",
    );
    assert.equal(
      textOf("data-section", "netLinesRemoved", "grimfeld/lifeline"),
      "Net lines removed -240 net lines removed: 145 deleted, 385 added. Tickets removing more than they added: 1. " +
        "Ticket Added Deleted Net removed #104 120 30 -90 #105 120 30 -90 PR #136 200 5 -195 #106 60 110 50 PR #137 5 0 -5",
    );
  });

  it("shows each ticket's lead time", () => {
    assert.equal(
      textOf("data-section", "leadTime", "grimfeld/lifeline"),
      "Lead time p50 12 h , p90 7.5 d . Ticket Lead time #104 12 h #105 20 h PR #136 6 h #106 7.5 d PR #137 10 h",
    );
  });

  it("shows each ticket's size proxies", () => {
    assert.match(
      textOf("data-section", "size", "grimfeld/lifeline"),
      /^Ticket size Median ticket: 150 lines changed in 3 files\. Ticket Diff lines Files Sub-tickets #104 150 3 2 #105 150 3 0 PR #136 205 101 0 #106 170 3 0 PR #137 5 1 0$/,
    );
  });

  it("shows estimate vs actual beside each ticket's size proxies", () => {
    assert.equal(
      textOf("data-section", "estimateVsActual", "grimfeld/lifeline"),
      "Estimate vs actual Median actual / estimate: 0.31 . Left out because the estimate came after the first commit: 1. " +
        "Ticket Estimate Actual Actual / estimate Diff lines Files Sub-tickets #104 4 h 11 h 2.75 150 3 2 #105 36 h 11 h 0.31 150 3 0",
    );
    assert.equal(textOf("data-section", "estimateVsActual", "grimfeld/agentic-metrics"), "Estimate vs actual unknown");
  });

  it("defines the diff and estimate metrics in Methodology", () => {
    assert.match(textOf("data-methodology", "testRatio"), /Lines added to test files divided by lines added to production files/);
    assert.match(textOf("data-methodology", "netLinesRemoved"), /Lines deleted minus lines added/);
    assert.match(textOf("data-methodology", "size"), /diff size .* files touched .* sub-tickets/);
    const estimate = textOf("data-methodology", "estimateVsActual");
    assert.match(estimate, /earliest comment on its issue/);
    assert.match(estimate, /Coverage: grimfeld\/agentic-metrics 0 of 0 tickets; grimfeld\/lifeline 2 of 5 tickets/);
  });

  it("links each repo's raw dataset from its own section", () => {
    assert.match(section("grimfeld/lifeline"), /<a href="datasets\/grimfeld\/lifeline\.json">/);
    assert.match(section("grimfeld/agentic-metrics"), /<a href="datasets\/grimfeld\/agentic-metrics\.json">/);
  });

  it("lists every tracked repo at the top, linking to its section", () => {
    const nav = textOf("id", "repos");
    assert.equal(nav, "grimfeld/agentic-metrics grimfeld/lifeline");
    assert.match(html, /<a href="#grimfeld\/lifeline">/);
    assert.match(html, /<section class="repo" id="grimfeld\/lifeline" data-repo="grimfeld\/lifeline">/);
  });

  it("links each raw dataset from Methodology, copied next to the report", () => {
    assert.match(html, /<a href="datasets\/grimfeld\/lifeline\.json">/);
    assert.equal(
      readFileSync(join(cwd, "report/datasets/grimfeld/lifeline.json"), "utf8"),
      readFileSync(join(cwd, "datasets/grimfeld/lifeline.json"), "utf8"),
    );
  });
});

describe("report with no dataset", () => {
  it("renders an empty-state page, not a crash, when the datasets folder is missing or empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "am-report-empty-"));
    try {
      for (const datasets of ["missing", "."]) {
        let stdout = "";
        let stderr = "";
        const status = await main(["report", "--datasets", datasets, "--out", "site"], {
          cwd: dir,
          stdout: (text) => (stdout += text),
          stderr: (text) => (stderr += text),
        });
        assert.equal(status, 0, stderr);
        assert.match(stdout, /no dataset/i);
        assert.match(readFileSync(join(dir, "site/index.html"), "utf8"), /No repo tracked yet/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
