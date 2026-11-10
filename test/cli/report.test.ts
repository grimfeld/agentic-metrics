import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";
import { metricPage, readPages, repoPage } from "./report-pages.ts";

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
  // Each repo's page, then Methodology.
  html = readPages(join(cwd, "report"), [repoPage("grimfeld/agentic-metrics"), repoPage("grimfeld/lifeline"), "methodology.html"]);
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

/** The visible text of a section of a metric's page. */
function onMetricPage(repo: string, id: string, section: string): string {
  const page = readPages(join(cwd, "report"), [metricPage(repo, id)]);
  const match = new RegExp(`<section [^>]*data-section="${section}"[^>]*>([\\s\\S]*?)</section>`).exec(page);
  assert.ok(match, `no ${section} section on ${id}'s page`);
  return (match[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function section(repo: string): string {
  const match = new RegExp(`<section class="repo"[^>]* data-repo="${repo}">([\\s\\S]*?)</section><!-- /repo -->`).exec(html);
  assert.ok(match, `no section for ${repo}`);
  return match[1] ?? "";
}

describe("report", () => {
  it("shows the headline tiles first for each repo, in order: active time, not lead time, leads", () => {
    const tiles = [...section("grimfeld/lifeline").matchAll(/<a class="tile lg" [^>]*data-metric="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(tiles, ["activeTime", "estimatedActiveTime", "firstRunCiRate", "humanMessagesPerTicket", "regressionRate"]);
    assert.match(section("grimfeld/lifeline"), /^\s*<section class="tiles"[^>]*>\s*<a class="tile lg" [^>]*data-metric="activeTime"/);
  });

  it("shows lead time as a supporting figure, with its coverage", () => {
    assert.equal(textOf("data-metric", "leadTime", "grimfeld/lifeline"), "Lead time 12 h p50 5 of 5 tickets");
  });

  it("shows the first-run CI rate as unknown when no PR has a CI run", () => {
    assert.equal(textOf("data-metric", "firstRunCiRate", "grimfeld/lifeline"), "First-run CI rate unknown 0 of 5 tickets");
  });

  it("shows the regression rate on its card, with its coverage", () => {
    assert.equal(textOf("data-metric", "regressionRate", "grimfeld/lifeline"), "Regression rate 60% 4 regressions 5 of 5 tickets");
    assert.equal(textOf("data-metric", "regressionRate", "grimfeld/agentic-metrics"), "Regression rate unknown 0 of 0 tickets");
  });

  it("lists regressions per ticket on its page, and the untraced ones", () => {
    assert.equal(
      onMetricPage("grimfeld/lifeline", "regressionRate", "tickets"),
      "Per ticket 3 rows · select a column heading to sort Ticket Title Delivered Regressions Regression issues " +
        "#104 Lifeline issue title 104 2026-10-19 1 #141 PR #136 Lifeline PR title 136 2026-10-27 1 #142 #106 Lifeline issue title 106 2026-10-28 2 #140, #145",
    );
    assert.equal(
      onMetricPage("grimfeld/lifeline", "regressionRate", "regressionRate"),
      "Summary 4 regressions traced to 3 delivered tickets. Untraced, and left out of the rate: #143, #144.",
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

  it("shows throughput per week on its page", () => {
    assert.match(onMetricPage("grimfeld/lifeline", "throughput", "chart"), / Week of Tickets PRs 2026-10-19 2 2 2026-10-26 2 2 2026-11-02 0 0 2026-11-09 1 1$/);
    assert.equal(
      onMetricPage("grimfeld/lifeline", "throughput", "throughput"),
      "Summary 5 tickets in 5 PRs over 4 weeks, 1 week with none. The busiest, the week of 2026-10-19, delivered 2.",
    );
  });

  it("defines each metric present in Methodology, with its coverage per repo", () => {
    const leadTime = textOf("data-methodology", "leadTime");
    assert.match(leadTime, /^Lead time Time from a ticket becoming ready to its last PR merging into the default branch/);
    assert.match(leadTime, /Coverage: grimfeld\/agentic-metrics 0 of 0 tickets; grimfeld\/lifeline 5 of 5 tickets/);
    assert.match(textOf("data-methodology", "throughput"), /^Throughput Tickets and pull requests delivered per week/);
  });

  it("shows the test ratio and net lines changed on their pages, with each ticket's lines", () => {
    assert.equal(
      onMetricPage("grimfeld/lifeline", "testRatio", "testRatio"),
      "Summary 0.59 test lines added per production line: 65 test lines for 110 production lines.",
    );
    assert.match(
      onMetricPage("grimfeld/lifeline", "testRatio", "tickets"),
      / Test lines Production lines Test \/ production #104 .* 30 80 0\.38 #105 .* 30 80 0\.38 #106 .* 30 30 1 PR #137 .* 5 0 unknown$/,
    );
    assert.equal(
      onMetricPage("grimfeld/lifeline", "netLinesRemoved", "netLinesRemoved"),
      "Summary +240 net lines changed: 385 added, 145 deleted. Tickets removing more than they added: 1.",
    );
    assert.match(
      onMetricPage("grimfeld/lifeline", "netLinesRemoved", "tickets"),
      / Added Deleted Net change #104 .* 120 30 \+90 #105 .* 120 30 \+90 PR #136 .* 200 5 \+195 #106 .* 60 110 −50 PR #137 .* 5 0 \+5$/,
    );
  });

  it("says in Methodology that an issue closed with no PR is not a delivered ticket", () => {
    for (const id of ["throughput", "leadTime"]) assert.match(textOf("data-methodology", id), /closed with no (merged )?PR/, id);
  });

  it("shows each ticket's lead time on its page", () => {
    assert.match(
      onMetricPage("grimfeld/lifeline", "leadTime", "tickets"),
      / Landing wait #104 Lifeline issue title 104 2026-10-19 12 h 1 h 0\.5 h 10\.5 h #105 .* 20 h .* PR #136 .* 6 h .* #106 .* 7\.5 d 9 h 7 d 3 h PR #137 .* 10 h 1 h 0 h 9 h$/,
    );
    assert.equal(
      onMetricPage("grimfeld/lifeline", "leadTime", "leadTime"),
      "Summary Half the tickets took up to 12 h from ready to delivered, and nine in ten up to 7.5 d . Over the 5 tickets with dated activity, that time went to: Queue 9.2% (p50 1 h), Work 74.1% (p50 0.5 h), Landing wait 16.7% (p50 9 h). Queue and landing wait are idle; work can hold idle too (see active time).",
    );
  });

  it("shows each ticket's size proxies on its page", () => {
    assert.equal(onMetricPage("grimfeld/lifeline", "size", "size"), "Summary Median ticket: 150 lines changed in 3 files.");
    assert.match(
      onMetricPage("grimfeld/lifeline", "size", "tickets"),
      / Diff lines Files Sub-tickets #104 .* 150 3 2 #105 .* 150 3 0 PR #136 .* 205 101 0 #106 .* 170 3 0 PR #137 .* 5 1 0$/,
    );
  });

  it("shows estimate vs actual beside each ticket's size proxies on its page", () => {
    assert.equal(
      onMetricPage("grimfeld/lifeline", "estimateVsActual", "estimateVsActual"),
      "Summary Median actual / estimate: 0.04 , the actual being the ticket's active time. Left out because the estimate came after the first commit: 1; because the active time is unknown: 0.",
    );
    assert.match(
      onMetricPage("grimfeld/lifeline", "estimateVsActual", "tickets"),
      / Estimate Actual Actual is Actual \/ estimate Diff lines Files Sub-tickets #104 .* 4 h 30 min estimated 0\.13 150 3 2 #105 .* 12 h 30 min estimated 0\.04 150 3 0$/,
    );
    assert.equal(onMetricPage("grimfeld/agentic-metrics", "estimateVsActual", "estimateVsActual"), "Summary unknown");
  });

  it("defines the diff and estimate metrics in Methodology", () => {
    assert.match(textOf("data-methodology", "testRatio"), /Lines added to test files divided by lines added to production files/);
    assert.match(textOf("data-methodology", "netLinesRemoved"), /Lines added minus lines deleted/);
    assert.match(textOf("data-methodology", "size"), /diff size .* files touched .* sub-tickets/);
    const estimate = textOf("data-methodology", "estimateVsActual");
    assert.match(estimate, /earliest comment on its issue/);
    assert.match(estimate, /Coverage: grimfeld\/agentic-metrics 0 of 0 tickets; grimfeld\/lifeline 2 of 5 tickets/);
  });

  it("links each repo's raw dataset from its own page", () => {
    const page = (repo: string) => readPages(join(cwd, "report"), [repoPage(repo)]);
    assert.match(page("grimfeld/lifeline"), /<a class="chip" href="\.\.\/datasets\/grimfeld\/lifeline\.json">raw dataset<\/a>/);
    assert.match(page("grimfeld/agentic-metrics"), /<a class="chip" href="\.\.\/datasets\/grimfeld\/agentic-metrics\.json">raw dataset<\/a>/);
  });

  it("links each raw dataset from Methodology, copied next to the report", () => {
    assert.match(readPages(join(cwd, "report"), ["methodology.html"]), /<a href="datasets\/grimfeld\/lifeline\.json">/);
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
