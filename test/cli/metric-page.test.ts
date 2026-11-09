// A metric's page: number tiles, its chart, its monthly trend, its per-ticket
// table (sortable, `full` repos only) and its definition. Fixtures in
// (lifeline with its transcripts, full and anonymized), then `collect`, then
// `report`; assertions on the rendered pages only.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";
import { transcriptCache } from "../../cli/transcripts/source.ts";
import { metricPage, readPages } from "./report-pages.ts";

const GITHUB = join(import.meta.dirname, "../fixtures/github");
const CACHE = join(import.meta.dirname, "../fixtures/transcript-cache/cost");
const NOW = new Date("2026-11-09T12:00:00Z");

/** The metrics whose pages this suite checks. */
/** Where each has data: the `ci` fixture has CI, `lifeline` the rest. */
const CI = new Set(["firstRunCiRate", "fixCycles", "scheduledFailures", "batchHealth"]);
const PAGES = ["leadTime", "throughput", "firstRunCiRate", "fixCycles", "scheduledFailures", "batchHealth", "regressionRate", "humanMessagesPerTicket"];

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
    assert.match(text(tiles), /^Lead time 12 h p50 · 7\.5 d p90 5 of 5 tickets Months known 2 of 2/);
    assert.match(text(tiles), /Full \S+ h 3 of 3 tickets/);
  });

  it("draws its chart, its monthly trend and its comparison by autonomy level as accessible SVGs", () => {
    const html = page("grimfeld/lifeline", "leadTime");
    for (const section of ["chart", "by-month", "by-autonomy"]) {
      assert.match(element(html, "data-section", section), /<svg class="chart"[^>]* role="img" aria-labelledby="[\w-]+ [\w-]+"><title id="[\w-]+">[^<]+<\/title><desc/, section);
    }
    const titles = [...html.matchAll(/<title id="[\w-]+">([^<]+)<\/title>/g)].map((m) => m[1]);
    assert.deepEqual(titles, ["Lead time per ticket", "Lead time by month", "Lead time by autonomy level"]);
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
      "Ticket Title Delivered Lead time",
      "#104 Lifeline issue title 104 2026-10-19 12 h",
      "#105 Lifeline issue title 105 2026-10-19 20 h",
      "PR #136 Lifeline PR title 136 2026-10-27 6 h",
      "#106 Lifeline issue title 106 2026-10-28 7.5 d",
      "PR #137 Lifeline PR title 137 2026-11-09 10 h",
    ]);
    assert.match(table, /<table class="sortable">/);
    assert.match(table, /<td><a href="https:\/\/github\.com\/grimfeld\/lifeline\/issues\/106">#106<\/a><\/td>/);
    // Sorted on its number, not its text: 7.5 d is the longest.
    assert.match(table, /<td class="num" data-sort="180">7\.5 d<\/td>/);
  });
});

describe("metric page: anonymized", () => {
  it("has no per-ticket table, and names no ticket", () => {
    for (const id of PAGES) {
      const html = page("client-a", id);
      assert.doesNotMatch(html, /data-section="tickets"/, id);
      const main = /<main>[\s\S]*<\/main>/.exec(html)?.[0] ?? "";
      assert.doesNotMatch(main, /#\d|PR #/, id);
    }
  });
});

describe("metric pages: the eight of part 1", () => {
  it("each has tiles, a chart, a monthly trend, a definition and, for a full repo, a per-ticket table", () => {
    for (const id of PAGES) {
      const html = page(CI.has(id) ? "grimfeld/ci" : "grimfeld/lifeline", id);
      for (const section of ["tiles", "trend", "definition", "tickets"]) assert.match(html, new RegExp(`data-section="${section}"`), `${id}: ${section}`);
      assert.match(html, /<svg class="chart"[^>]* role="img"/, id);
    }
  });

  it("are each linked from the sidebar of every page", () => {
    const overview = readFileSync(join(cwd, "report/index.html"), "utf8");
    for (const id of PAGES) assert.match(overview, new RegExp(`<a href="grimfeld--lifeline/${id}\\.html">`), id);
    assert.match(page("grimfeld/lifeline", "leadTime"), /<a href="leadTime\.html" aria-current="page">/);
  });
});
