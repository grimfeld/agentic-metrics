// A repo's page: number tiles with sparklines, the grid of charts built from
// the metrics that declare one, the CV sentences and the case-study cards.
// Fixtures in (lifeline with its cost transcripts, full and anonymized), then
// `collect`, then `report`; assertions on the rendered page only.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";
import { transcriptCache } from "../../cli/transcripts/source.ts";
import { METRICS } from "../../cli/metrics/index.ts";
import { readPages, repoPage } from "./report-pages.ts";

const GITHUB = join(import.meta.dirname, "../fixtures/github");
const CACHE = join(import.meta.dirname, "../fixtures/transcript-cache/cost");
const NOW = new Date("2026-11-09T12:00:00Z");

let cwd: string;
let full: string;
let anonymized: string;
let empty: string;

async function run(argv: string[], fixture: string) {
  let stderr = "";
  const status = await main(argv, {
    cwd,
    github: fixtureSource(join(GITHUB, fixture)),
    transcripts: transcriptCache({ dir: CACHE, repoDir: "/Users/dev/repos/lifeline" }),
    now: () => NOW,
    stdout: () => undefined,
    stderr: (text) => (stderr += text),
  });
  assert.equal(status, 0, stderr);
}

before(async () => {
  cwd = mkdtempSync(join(tmpdir(), "am-repo-page-"));
  await run(["collect"], "lifeline");
  await run(["collect"], "empty");
  const draft = join(cwd, "case-studies/grimfeld/lifeline/106.md");
  writeFileSync(draft, readFileSync(draft, "utf8").replace(/^approved: false$/m, "approved: true"));
  writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify({ alias: "client-a" }));
  await run(["collect"], "private");
  rmSync(join(cwd, ".agentic-metrics.json"));
  await run(["report"], "empty");
  const read = (repo: string) => readPages(join(cwd, "report"), [repoPage(repo)]);
  full = read("grimfeld/lifeline");
  anonymized = read("client-a");
  empty = read("grimfeld/agentic-metrics");
});

after(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** The outer HTML of the first element carrying `attribute="value"`. */
function element(html: string, attribute: string, value: string): string {
  const match = new RegExp(`<(\\w+)[^>]* ${attribute}="${value}"[^>]*>[\\s\\S]*?</\\1>`).exec(html);
  assert.ok(match, `no element with ${attribute}="${value}"`);
  return match[0];
}

/** A chart card, by the metric it charts. */
function chartCard(html: string, id: string): string {
  const match = new RegExp(`<section class="card chart-card" data-chart="${id}">[\\s\\S]*?</section>`).exec(html);
  assert.ok(match, `no chart card for ${id}`);
  return match[0];
}

/** The rows of a chart card's numbers table, as text. */
function numbers(card: string): string[] {
  const table = /<details class="numbers">[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(card);
  assert.ok(table, "no numbers table");
  return [...(table[1] ?? "").matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((row) => text(row[1] ?? ""));
}

describe("repo page: number tiles", () => {
  it("shows a tile per metric, headline metrics first, each linking to the metric's page", () => {
    const tiles = [...full.matchAll(/<a class="tile[^"]*" href="([^"]+)" data-metric="(\w+)"/g)].map((match) => [match[1], match[2]]);
    const ids = tiles.map(([, id]) => id);
    assert.deepEqual(ids.slice(0, 5), ["activeTime", "estimatedActiveTime", "firstRunCiRate", "humanMessagesPerTicket", "regressionRate"]);
    assert.deepEqual([...ids].sort(), METRICS.map((metric) => metric.id).sort());
    for (const [href, id] of tiles) assert.equal(href, `${id ?? ""}.html`);
  });

  it("states each tile's number and coverage as text", () => {
    assert.equal(text(element(full, "data-metric", "leadTime")), "Lead time 12 h p50 5 of 5 tickets");
    assert.equal(text(element(full, "data-metric", "throughput")), "Throughput 5 tickets 5 of 5 tickets");
    assert.equal(text(element(full, "data-metric", "firstRunCiRate")), "First-run CI rate unknown 0 of 5 tickets");
  });

  it("draws a sparkline of the monthly trend on each tile with a known month, and none otherwise", () => {
    assert.match(element(full, "data-metric", "leadTime"), /<svg class="spark"[^>]*aria-hidden="true"[^>]*>.*<polyline/);
    assert.doesNotMatch(element(full, "data-metric", "firstRunCiRate"), /<svg/);
  });
});

describe("repo page: no detail", () => {
  it("leaves each metric's summary, trend, comparison and tables to its page", () => {
    assert.doesNotMatch(full, />Detail</);
    for (const { id } of METRICS) assert.doesNotMatch(full, new RegExp(`data-section="${id}"`), id);
    assert.doesNotMatch(full, /data-trend=|data-autonomy=|data-section="tickets"/);
  });
});

describe("repo page: chart grid", () => {
  const charted = METRICS.filter((metric) => metric.chart).map((metric) => metric.id);

  it("has a card for each metric that declares a chart, in report order", () => {
    assert.deepEqual(charted, [
      "activeTime",
      "estimatedActiveTime",
      "leadTime",
      "throughput",
      "friction",
      "orchestrationTime",
      "subAgents",
      "apiEquivalentCost",
      "autonomy",
      "testRatio",
      "netLinesRemoved",
      "size",
      "estimateVsActual",
    ]);
    const cards = [...full.matchAll(/<section class="card chart-card" data-chart="(\w+)">/g)].map((match) => match[1]);
    assert.deepEqual(cards, charted);
  });

  it("draws each chart as an inline SVG with an accessible title and description", () => {
    for (const id of charted) {
      const card = chartCard(full, id);
      // Lifeline's tickets have a transcript or a single commit: none is estimated.
      if (id === "estimatedActiveTime") {
        assert.equal(text(card), "Active time, estimated per ticket unknown 0 of 5 tickets");
        continue;
      }
      const svg = /<svg class="chart"[^>]* role="img" aria-labelledby="([\w-]+) ([\w-]+)">\s*<title id="\1">([^<]+)<\/title><desc id="\2">([^<]+)<\/desc>/.exec(card);
      assert.ok(svg, `${id}: no accessible svg`);
    }
    assert.match(chartCard(full, "throughput"), /<desc id="[\w-]+">Tickets delivered in each of 4 weeks, 5 in all; the busiest, the week of 2026-10-19, delivered 2\.<\/desc>/);
  });

  it("gives every chart's numbers as text, with the coverage", () => {
    const lead = chartCard(full, "leadTime");
    assert.deepEqual(numbers(lead), ["Queue 7.5% p50 1 h", "Work 75.9% p50 1.5 h", "Landing wait 16.7% p50 9 h"]);
    assert.match(text(lead), /5 of 5 tickets/);
    assert.deepEqual(numbers(chartCard(full, "throughput")), ["2026-10-19 2 2", "2026-10-26 2 2", "2026-11-02 0 0", "2026-11-09 1 1"]);
    assert.deepEqual(numbers(chartCard(full, "autonomy")), ["Full 3 60%", "Assisted 1 20%", "Manual 1 20%"]);
  });

  it("draws an unpriced model's cost as unknown, never as a zero bar", () => {
    const cost = chartCard(full, "apiEquivalentCost");
    assert.deepEqual(numbers(cost), ["claude-opus-5-5 $1.09", "claude-sonnet-5-5 $0.12", "claude-haiku-5-5 $0.02", "claude-future-9 unknown"]);
    const svg = /<svg[\s\S]*<\/svg>/.exec(cost)?.[0] ?? "";
    assert.equal((svg.match(/<path class="bar/g) ?? []).length, 3, "three bars: the unpriced model has none");
    assert.match(svg, /<text[^>]*>unknown<\/text>/);
  });

  it("says unknown, with no chart, when a metric has no data", () => {
    const card = chartCard(empty, "leadTime");
    assert.doesNotMatch(card, /<svg/);
    assert.equal(text(card), "Lead time breakdown unknown 0 of 0 tickets");
  });
});

describe("repo page: sentences and case studies", () => {
  it("shows the CV sentences in a card", () => {
    assert.match(element(full, "data-section", "cv-sentences"), /data-sentence="leadTime"/);
  });

  it("shows a card per approved case study, titled from its heading", () => {
    const studies = element(full, "data-section", "case-studies");
    assert.match(studies, /<a class="study-card" href="case-studies\/106\.html"><b>#106 Lifeline issue title 106<\/b>/);
  });
});

describe("repo page: anonymized", () => {
  it("charts aggregates only: no ticket anywhere, suppressed months as —", () => {
    const repo = /<section class="repo"[\s\S]*<\/section><!-- \/repo -->/.exec(anonymized)?.[0] ?? "";
    assert.ok(repo);
    assert.doesNotMatch(repo, /#10\d|PR #13\d/);
    // Lead time keeps its phases' aggregates; size keeps no ticket, so it draws its median by month.
    assert.deepEqual(numbers(chartCard(anonymized, "leadTime")), ["Queue 7.5% p50 1 h", "Work 75.9% p50 1.5 h", "Landing wait 16.7% p50 9 h"]);
    const size = chartCard(anonymized, "size");
    assert.deepEqual(numbers(size), ["Oct 2026 150 4 of 4", "Nov 2026 — 1 of 1"]);
    assert.match(/<svg[\s\S]*<\/svg>/.exec(size)?.[0] ?? "", /<text[^>]*>—<\/text>/);
  });

  it("has no case-study cards", () => {
    assert.doesNotMatch(anonymized, /data-section="case-studies"/);
  });
});
