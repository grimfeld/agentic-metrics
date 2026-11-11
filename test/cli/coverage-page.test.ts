// A repo's data coverage page: each metric's coverage, the gaps holding it
// back, and each gap's fix. Fixtures in, `collect`, `report`, then the page.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";

const FIXTURES = join(import.meta.dirname, "../fixtures/github");

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-coverage-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

async function site(fixture: string): Promise<void> {
  const deps = { cwd, github: fixtureSource(join(FIXTURES, fixture)), now: () => new Date("2026-11-09T12:00:00Z"), stdout: () => {} };
  assert.equal(await main(["collect"], deps), 0);
  assert.equal(await main(["report"], deps), 0);
}

const page = (path: string) => readFileSync(join(cwd, "report", path), "utf8").replace(/<style>[\s\S]*?<\/style>/g, "");

describe("coverage page", () => {
  it("links each metric to its own page", async () => {
    await site("lifeline");
    const html = page("grimfeld--lifeline/coverage.html");

    assert.match(html, /<tr data-metric="leadTime"><td><a href="leadTime.html">Lead time<\/a><\/td><td>5 of 5 tickets<\/td>/);
    assert.match(html, /<tr data-metric="humanMessagesPerTicket"><td><a href="humanMessagesPerTicket.html">/);
  });

  it("lists a gap under every metric it affects, and gives its fix", async () => {
    await site("lifeline");
    const html = page("grimfeld--lifeline/coverage.html");

    for (const metric of ["activeTime", "humanMessagesPerTicket", "apiEquivalentCost"]) {
      assert.match(html, new RegExp(`<tr data-metric="${metric}">.*<a href="#gap-no-session-data">no-session-data</a> \\(5 tickets\\)`), metric);
    }
    assert.match(html, /<article class="gap" id="gap-no-session-data"/);
    assert.match(html, /Tickets: #104, #105, PR #136, #106, PR #137/);
    assert.match(html, /<p class="fix">Add the "ready-for-agent" label/);
  });

  it("is linked from the repo page, the sidebar and the overview's repo table", async () => {
    await site("lifeline");

    assert.match(page("grimfeld--lifeline/index.html"), /<a class="chip" href="coverage.html">data coverage: \d+ gaps<\/a>/);
    assert.match(page("grimfeld--lifeline/leadTime.html"), /<a href="coverage.html">Data coverage<span class="v">\d+<\/span><\/a>/);
    assert.match(page("index.html"), /<td><a href="grimfeld--lifeline\/coverage.html">\d+<\/a><\/td>/);
  });

  it("holds no ticket number for an anonymized repo", async () => {
    writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify({ publish: "anonymized", alias: "client-a" }));
    await site("lifeline");
    const html = page("client-a/coverage.html");

    assert.match(html, /\(5 tickets\)/);
    assert.doesNotMatch(html, /#\d|Tickets:/);
  });

  it("says when there is no gap", async () => {
    await site("lifeline");
    const file = join(cwd, "datasets/grimfeld/lifeline.json");
    writeFileSync(file, JSON.stringify({ ...(JSON.parse(readFileSync(file, "utf8")) as object), gaps: [] }));
    assert.equal(await main(["report"], { cwd, stdout: () => {} }), 0);

    assert.match(page("grimfeld--lifeline/coverage.html"), /No gap: every metric has the data it needs/);
  });
});
