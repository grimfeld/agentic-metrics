// The report as a site: which pages it writes, the shell they share, the
// overview and Methodology pages, and every relative link resolving. Fixtures
// in, then `collect`, then `report`; assertions on the files written.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";

const FIXTURES = join(import.meta.dirname, "../fixtures/github");
const NOW = new Date("2026-11-09T12:00:00Z");

let cwd: string;

async function run(argv: string[], fixture = "empty") {
  let stderr = "";
  const status = await main(argv, {
    cwd,
    github: fixtureSource(join(FIXTURES, fixture)),
    now: () => NOW,
    stdout: () => undefined,
    stderr: (text) => (stderr += text),
  });
  assert.equal(status, 0, stderr);
}

/** Every file under `dir`, relative to it, with `/` separators. */
function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split("\\").join("/"))
    .sort();
}

function page(path: string): string {
  return readFileSync(join(cwd, "report", path), "utf8");
}

/** The visible text of an HTML fragment. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** The inner HTML of the first element carrying `attribute="value"`. */
function element(html: string, attribute: string, value: string): string {
  const match = new RegExp(`<(\\w+)[^>]* ${attribute}="${value}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
  assert.ok(match, `no element with ${attribute}="${value}"`);
  return match[2] ?? "";
}

/** The relative links of a page that point at another file: no scheme, no bare fragment. */
function relativeLinks(html: string): string[] {
  return [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)]
    .map((match) => match[1] ?? "")
    .filter((url) => !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("#"))
    .map((url) => url.replace(/#.*$/, ""));
}

function sidebar(html: string): string {
  const match = /<nav class="side"[^>]*>([\s\S]*?)<\/nav>/.exec(html);
  assert.ok(match, "no sidebar");
  return match[1] ?? "";
}

before(async () => {
  cwd = mkdtempSync(join(tmpdir(), "am-site-"));
  await run(["collect"], "lifeline");
  await run(["collect"], "empty");
  // An approved case study for lifeline.
  const draft = join(cwd, "case-studies/grimfeld/lifeline/106.md");
  writeFileSync(draft, readFileSync(draft, "utf8").replace(/^approved: false$/m, "approved: true"));
  // And an anonymized repo beside them.
  writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify({ alias: "client-a" }));
  await run(["collect"], "private");
  rmSync(join(cwd, ".agentic-metrics.json"));
  await run(["report"]);
});

after(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("report site", () => {
  it("writes the overview, Methodology, a page per repo, per metric and per approved case study", () => {
    const written = files(join(cwd, "report"));
    for (const path of [
      "index.html",
      "methodology.html",
      "grimfeld--lifeline/index.html",
      "grimfeld--lifeline/leadTime.html",
      "grimfeld--lifeline/throughput.html",
      "grimfeld--lifeline/case-studies/106.html",
      "grimfeld--agentic-metrics/index.html",
      "client-a/index.html",
      "client-a/leadTime.html",
      "datasets/grimfeld/lifeline.json",
      "datasets/client-a.json",
    ]) {
      assert.ok(written.includes(path), `${path} not written`);
    }
    // An anonymized repo gets no case-study page, and an unapproved draft none either.
    assert.equal(written.some((path) => path.startsWith("client-a/case-studies/")), false);
    assert.equal(existsSync(join(cwd, "report/grimfeld--lifeline/case-studies/104.html")), false);
  });

  it("resolves every relative link of every page to a written file", () => {
    const root = join(cwd, "report");
    const pages = files(root).filter((path) => path.endsWith(".html"));
    assert.ok(pages.length > 10);
    for (const path of pages) {
      for (const link of relativeLinks(page(path))) {
        assert.ok(link !== "" && !link.startsWith("/"), `${path} links ${JSON.stringify(link)}: not relative`);
        const target = resolve(dirname(join(root, path)), decodeURIComponent(link));
        assert.ok(target.startsWith(root), `${path} links ${link}: outside the site`);
        assert.ok(existsSync(target), `${path} links ${link}: no such file`);
      }
    }
  });

  it("lists Overview, each repo with its metrics and case studies, then Methodology, in every page's sidebar", () => {
    for (const path of ["index.html", "methodology.html", "grimfeld--lifeline/leadTime.html", "client-a/index.html"]) {
      const nav = sidebar(page(path));
      const labels = text(nav);
      const order = ["Overview", "client-a", "grimfeld/agentic-metrics", "grimfeld/lifeline", "Methodology"].map((label) => labels.indexOf(label));
      assert.ok(order.every((index, i) => index >= 0 && (i === 0 || index > (order[i - 1] ?? 0))), `${path}: ${labels}`);
      // From inside a repo's folder, its own pages link without it.
      assert.match(nav, /href="(?:[^"]*grimfeld--lifeline\/)?leadTime\.html"[^>]*>Lead time</, path);
      assert.match(nav, /href="[^"]*client-a\/regressionRate\.html"|href="regressionRate\.html"/, path);
      assert.match(nav, /href="(?:[^"]*grimfeld--lifeline\/)?case-studies\/106\.html"/, path);
    }
    // The current page is marked.
    assert.match(sidebar(page("grimfeld--lifeline/leadTime.html")), /<a href="leadTime\.html" aria-current="page"/);
  });

  it("links up from a nested page and down from the top one", () => {
    assert.match(sidebar(page("index.html")), /<a href="methodology\.html"/);
    assert.match(sidebar(page("grimfeld--lifeline/index.html")), /<a href="\.\.\/methodology\.html"/);
    assert.match(sidebar(page("grimfeld--lifeline/case-studies/106.html")), /<a href="\.\.\/\.\.\/methodology\.html"/);
  });

  it("turns the sidebar into a top bar at phone width, and defines dark-mode colour tokens", () => {
    const html = page("index.html");
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(html, /@media \(max-width: \d+px\) \{[^}]*nav\.side \{[^}]*overflow-x: auto/);
    assert.match(html, /@media \(prefers-color-scheme: dark\) \{\s*:root[^{]*\{[^}]*--ink:/);
  });

  it("loads nothing from the network", () => {
    for (const path of files(join(cwd, "report")).filter((file) => file.endsWith(".html"))) {
      const html = page(path);
      assert.doesNotMatch(html, /<(?:script|img|iframe|link)\b[^>]*\s(?:src|href)="(?:https?:)?\/\//, path);
      assert.doesNotMatch(html, /@import|url\(\s*["']?(?:https?:)?\/\//, path);
    }
  });
});

describe("overview page", () => {
  it("pools its four headline tiles over the full repos only, naming them", () => {
    const html = page("index.html");
    const tiles = [...html.matchAll(/<article class="tile" data-headline="(\w+)"/g)].map((match) => match[1]);
    assert.deepEqual(tiles, ["leadTime", "firstRunCiRate", "humanMessagesPerTicket", "regressionRate"]);
    // Lifeline's 5 tickets pool with agentic-metrics' 0; client-a's are left out.
    assert.equal(text(element(html, "data-headline", "leadTime")), "Lead time 12 h p50 · 7.5 d p90 5 of 5 tickets Covers grimfeld/lifeline");
    assert.equal(
      text(element(html, "data-headline", "regressionRate")),
      "Regression rate 60% 4 regressions 5 of 5 tickets Covers grimfeld/lifeline",
    );
    assert.equal(text(element(html, "data-headline", "firstRunCiRate")), "First-run CI rate unknown 0 of 5 tickets No full repo has data");
    assert.match(text(element(html, "data-headline", "leadTime")), /^(?!.*client-a)/);
  });

  it("compares every repo, anonymized ones included, in a table and a card each", () => {
    const html = page("index.html");
    const table = element(html, "data-section", "repos");
    assert.deepEqual(
      [...table.matchAll(/<tr data-repo="([^"]+)">/g)].map((match) => match[1]),
      ["client-a", "grimfeld/agentic-metrics", "grimfeld/lifeline"],
    );
    assert.match(element(table, "data-repo", "client-a"), /<a href="client-a\/index\.html">client-a<\/a>/);
    assert.match(text(element(table, "data-repo", "client-a")), /^client-a anonymized 5 \d+ 12 h p50/);
    const cards = element(html, "data-section", "repo-cards");
    assert.match(cards, /<a class="repo-card" href="grimfeld--lifeline\/index\.html"/);
    assert.match(cards, /<a class="repo-card" href="client-a\/index\.html"/);
  });

  it("shows each repo's CV-ready sentences", () => {
    const sentences = element(page("index.html"), "data-section", "cv-sentences");
    assert.match(sentences, /data-sentence="grimfeld\/lifeline:leadTime"/);
    assert.match(sentences, /data-sentence="client-a:leadTime"/);
    assert.match(sentences, /<button type="button" data-copy="Median lead time of 12 h/);
  });
});

describe("Methodology page", () => {
  it("defines every metric with its coverage per repo and its limits, and links the raw data", () => {
    const html = page("methodology.html");
    const entry = text(element(html, "data-methodology", "leadTime"));
    assert.match(entry, /^Lead time Time from a ticket becoming ready/);
    assert.match(entry, /Limits: An issue closed with no merged PR/);
    assert.match(entry, /Coverage: client-a 5 of 5 tickets; grimfeld\/agentic-metrics 0 of 0 tickets; grimfeld\/lifeline 5 of 5 tickets/);
    assert.match(html, /<a href="datasets\/grimfeld\/lifeline\.json">/);
    assert.match(html, /<a href="datasets\/client-a\.json">/);
  });
});

describe("report site with no dataset", () => {
  it("writes the overview with an empty state, and Methodology, with working links", async () => {
    const dir = mkdtempSync(join(tmpdir(), "am-site-empty-"));
    try {
      mkdirSync(join(dir, "datasets"));
      const status = await main(["report"], { cwd: dir, stdout: () => undefined, stderr: () => undefined });
      assert.equal(status, 0);
      assert.deepEqual(files(join(dir, "report")), ["index.html", "methodology.html"]);
      const html = readFileSync(join(dir, "report/index.html"), "utf8");
      assert.match(html, /No repo tracked yet/);
      assert.match(sidebar(html), /<a href="methodology\.html"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
