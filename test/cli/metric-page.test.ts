// A metric's page: number tiles, its chart, its monthly trend, its per-ticket
// table (sortable, `full` repos only) and its definition. Fixtures in
// (lifeline with its transcripts, full and anonymized), then `collect`, then
// `report`; assertions on the rendered pages only.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";
import { transcriptCache } from "../../cli/transcripts/source.ts";
import { METRICS } from "../../cli/metrics/index.ts";
import { metricPage, readPages } from "./report-pages.ts";

const GITHUB = join(import.meta.dirname, "../fixtures/github");
const CACHE = join(import.meta.dirname, "../fixtures/transcript-cache/cost");
const NOW = new Date("2026-11-09T12:00:00Z");

/** Where each metric has data: the `ci` fixture has CI, `lifeline` the rest. */
const CI = new Set(["firstRunCiRate", "fixCycles", "reviewWait", "ciDuration", "scheduledFailures", "batchHealth"]);
/**
 * Every ticket here has a transcript or a single commit, so active time is
 * measured where it is known and estimated nowhere: the estimate's page says
 * unknown, with no chart or per-ticket table (`activity.test.ts` checks both
 * on a repo with no transcript).
 */
const ESTIMATED = "estimatedActiveTime";
const PART_1 = ["regressionTiming", "reviewWait", "ciDuration", "activeTime", "estimatedActiveTime", "leadTime", "throughput", "firstRunCiRate", "fixCycles", "scheduledFailures", "batchHealth", "regressionRate", "humanMessagesPerTicket"];
const PART_2 = ["attempts", "friction", "orchestrationTime", "subAgents", "skills", "apiEquivalentCost", "autonomy", "testRatio", "netLinesRemoved", "size", "estimateVsActual"];
/** Repo-level metrics: no ticket owns them, so they have no per-ticket table. */
const REPO_LEVEL = new Set(["orchestrationTime"]);

let cwd: string;

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
  cwd = mkdtempSync(join(tmpdir(), "am-metric-page-"));
  await run(["collect"], "lifeline");
  await run(["collect"], "ci");
  await run(["collect"], "empty");
  writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify({ alias: "client-a" }));
  await run(["collect"], "private");
  rmSync(join(cwd, ".agentic-metrics.json"));
  await run(["report"], "empty");
});

after(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function page(repo: string, id: string): string {
  return readPages(join(cwd, "report"), [metricPage(repo, id)]);
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** The outer HTML of the first element carrying `attribute="value"`. */
function element(html: string, attribute: string, value: string): string {
  const match = new RegExp(`<(\\w+)[^>]* ${attribute}="${value}"[^>]*>[\\s\\S]*?</\\1>`).exec(html);
  assert.ok(match, `no element with ${attribute}="${value}"`);
  return match[0];
}

/** A table's rows as text: its header row first. */
function rows(table: string): string[] {
  return [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((row) => text(row[1] ?? ""));
}

describe("metric page", () => {
  it("shows the metric's number tiles, with its coverage", () => {
    const tiles = element(page("grimfeld/lifeline", "leadTime"), "data-section", "tiles");
    assert.match(text(tiles), /^Lead time 12 h p50 5 of 5 tickets Months known 2 of 2/);
    assert.match(text(tiles), /Full \S+ h 3 of 3 tickets/);
  });

  it("draws its chart, its monthly trend and its comparison by autonomy level as accessible SVGs", () => {
    const html = page("grimfeld/lifeline", "leadTime");
    for (const section of ["chart", "by-month", "by-autonomy"]) {
      assert.match(element(html, "data-section", section), /<svg class="chart"[^>]* role="img" aria-labelledby="[\w-]+ [\w-]+"><title id="[\w-]+">[^<]+<\/title><desc/, section);
    }
    const titles = [...html.matchAll(/<title id="[\w-]+">([^<]+)<\/title>/g)].map((m) => m[1]);
    assert.deepEqual(titles, ["Lead time breakdown", "Lead time by month", "Lead time by autonomy level"]);
  });

  it("tabulates the monthly trend, with each month's coverage", () => {
    const trend = element(page("grimfeld/lifeline", "leadTime"), "data-section", "trend");
    assert.deepEqual(rows(trend), ["Month Lead time (p50) Tickets", "Oct 2026 12 h 4 of 4", "Nov 2026 10 h 1 of 1"]);
  });

  it("shows its definition and limits", () => {
    const definition = text(element(page("grimfeld/lifeline", "leadTime"), "data-section", "definition"));
    assert.match(definition, /^Definition Time from a ticket becoming ready/);
    assert.match(definition, /Limits: An issue closed with no merged PR/);
  });

  it("lists every ticket in a table that sorts by its column headings, and reads in delivery order without JavaScript", () => {
    const table = element(page("grimfeld/lifeline", "leadTime"), "data-section", "tickets");
    assert.deepEqual(rows(table), [
      "Ticket Title Delivered Lead time Queue Work Landing wait",
      "#104 Lifeline issue title 104 2026-10-19 12 h 0 h 1.5 h 10.5 h",
      "#105 Lifeline issue title 105 2026-10-19 20 h 8 h 1.5 h 10.5 h",
      "PR #136 Lifeline PR title 136 2026-10-27 6 h 1 h 0 h 5 h",
      "#106 Lifeline issue title 106 2026-10-28 7.5 d 8 h 7 d 3 h",
      "PR #137 Lifeline PR title 137 2026-11-09 10 h 0 h 1 h 9 h",
    ]);
    assert.match(table, /<table class="sortable">/);
    assert.match(table, /<td><a href="https:\/\/github\.com\/grimfeld\/lifeline\/issues\/106">#106<\/a><\/td>/);
    // Sorted on its number, not its text: 7.5 d is the longest.
    assert.match(table, /<td class="num" data-sort="180">7\.5 d<\/td>/);
  });
});

describe("metric page: anonymized", () => {
  it("has no per-ticket table, and names no ticket", () => {
    for (const { id } of METRICS) {
      const html = page("client-a", id);
      assert.doesNotMatch(html, /data-section="tickets"/, id);
      const main = /<main>[\s\S]*<\/main>/.exec(html)?.[0] ?? "";
      // `&#39;` is an escaped apostrophe, not a ticket.
      assert.doesNotMatch(main, /(?<!&)#\d|PR #/, id);
    }
  });
});

describe("metric pages: every metric", () => {
  it("has a page for every registered metric, in every repo", () => {
    assert.deepEqual([...PART_1, ...PART_2].sort(), METRICS.map((metric) => metric.id).sort());
    for (const repo of ["grimfeld/lifeline", "grimfeld/ci", "grimfeld/agentic-metrics", "client-a"]) {
      for (const { id } of METRICS) assert.ok(existsSync(join(cwd, "report", metricPage(repo, id))), `${repo}: no page for ${id}`);
    }
  });

  it("each has tiles, a chart, a monthly trend, a definition and, for a full repo, a per-ticket table", () => {
    for (const { id } of METRICS) {
      const html = page(CI.has(id) ? "grimfeld/ci" : "grimfeld/lifeline", id);
      for (const section of ["tiles", "trend", "definition", ...(REPO_LEVEL.has(id) || id === ESTIMATED ? [] : ["tickets"])]) {
        assert.match(html, new RegExp(`data-section="${section}"`), `${id}: ${section}`);
      }
      if (id === ESTIMATED) assert.match(html, /class="unknown">unknown</, id);
      else assert.match(html, /<svg class="chart"[^>]* role="img"/, id);
    }
  });

  it("are each linked from the sidebar of every page", () => {
    const overview = readFileSync(join(cwd, "report/index.html"), "utf8");
    for (const { id } of METRICS) assert.match(overview, new RegExp(`<a href="grimfeld--lifeline/${id}\\.html">`), id);
    assert.match(page("grimfeld/lifeline", "leadTime"), /<a href="leadTime\.html" aria-current="page">/);
  });
});

/** The text of each of a chart's axis and value labels. */
function svgTexts(html: string): string[] {
  const svg = /<svg class="chart"[\s\S]*?<\/svg>/.exec(html)?.[0] ?? "";
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1] ?? "");
}

describe("metric pages: part 2", () => {
  it("lists each ticket's figures", () => {
    const table = (id: string) => rows(element(page("grimfeld/lifeline", id), "data-section", "tickets"));
    assert.equal(table("testRatio")[0], "Ticket Title Delivered Test lines Production lines Test / production");
    assert.deepEqual(table("netLinesRemoved").slice(0, 2), ["Ticket Title Delivered Added Deleted Net change", "#104 Lifeline issue title 104 2026-10-19 120 30 +90"]);
    assert.equal(table("size")[0], "Ticket Title Delivered Diff lines Files Sub-tickets");
    assert.equal(table("estimateVsActual")[0], "Ticket Title Delivered Estimate Actual Actual is Actual / estimate Diff lines Files Sub-tickets");
    assert.equal(table("autonomy")[0], "Ticket Title Delivered Level Set");
    assert.equal(table("subAgents")[0], "Ticket Title Delivered Sub-agents Models");
    assert.equal(table("apiEquivalentCost")[0], "Ticket Title Delivered API equivalent");
  });

  it("says API equivalent wherever the cost page shows a dollar figure", () => {
    for (const repo of ["grimfeld/lifeline", "client-a"]) {
      const html = page(repo, "apiEquivalentCost");
      const sections = [...html.matchAll(/<section [^>]*data-section="([\w-]+)"[^>]*>([\s\S]*?)<\/section>/g)];
      assert.ok(sections.length > 0);
      for (const [, section, body] of sections) {
        if (/\$\d/.test(text(body ?? ""))) assert.match(text(body ?? ""), /API[- ]equivalent/i, `${repo}: ${section ?? ""}`);
      }
    }
  });

  it("draws net lines changed as lines changed: growth above the baseline, labelled with a +", () => {
    const html = page("grimfeld/lifeline", "netLinesRemoved");
    const labels = svgTexts(element(html, "data-section", "chart")).filter((label) => /\d/.test(label) && !/\d{4}/.test(label));
    assert.ok(labels.length > 0);
    // The code grew in every month: no label below zero.
    for (const label of labels) assert.match(label, /^\+/, label);
    // The levels where it grew have a bar.
    assert.match(element(html, "data-section", "by-autonomy"), /<path class="bar/);
  });

  it("draws orchestration time by month, its chart being its monthly trend", () => {
    const html = page("grimfeld/lifeline", "orchestrationTime");
    assert.match(element(html, "data-section", "chart"), /<title id="[\w-]+">Orchestration time by month<\/title>/);
    assert.doesNotMatch(html, /data-section="by-month"/);
  });

  it("each declares a chart, so that the repo page's grid has a card for it", () => {
    for (const id of PART_2) assert.ok(METRICS.find((metric) => metric.id === id)?.chart, id);
  });
});
