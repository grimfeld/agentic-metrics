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
  const match = new RegExp(`<section class="repo" data-repo="${repo}">([\\s\\S]*?)</section><!-- /repo -->`).exec(html);
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

  it("shows the metrics not computed yet as unknown", () => {
    assert.equal(textOf("data-metric", "firstRunCiRate", "grimfeld/lifeline"), "First-run CI rate unknown not measured yet");
    assert.equal(textOf("data-metric", "humanMessagesPerTicket", "grimfeld/lifeline"), "Human messages per ticket unknown not measured yet");
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
    assert.doesNotMatch(html, /data-methodology="firstRunCiRate"/);
  });

  it("links each raw dataset from Methodology, copied next to the report", () => {
    assert.match(html, /<a href="datasets\/grimfeld\/lifeline\.json">/);
    assert.equal(
      readFileSync(join(cwd, "report/datasets/grimfeld/lifeline.json"), "utf8"),
      readFileSync(join(cwd, "datasets/grimfeld/lifeline.json"), "utf8"),
    );
  });
});
