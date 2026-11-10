import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";
import { metricPage, readAllPages, readPages, repoPage } from "./report-pages.ts";

const FIXTURES = join(import.meta.dirname, "../fixtures/github");
const NOW = new Date("2026-11-09T12:00:00Z");

// The `private` fixture is the Lifeline fixture under a private repo,
// acme-corp/payroll-engine, whose tickets are titled "Payroll ... title N".
const LEAKS = [/acme-corp/i, /payroll/i, /title \d/i, /https?:/, /github\.com/, /#\d/, /PR #/];

let cwd: string;
let stderr: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-publish-"));
  stderr = "";
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function config(fields: Record<string, unknown>) {
  writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify(fields));
}

async function run(argv: string[], fixture: string): Promise<number> {
  return main(argv, {
    cwd,
    github: fixtureSource(join(FIXTURES, fixture)),
    now: () => NOW,
    stdout: () => undefined,
    stderr: (text) => (stderr += text),
  });
}

async function collect(fixture: string) {
  assert.equal(await run(["collect"], fixture), 0, stderr);
}

/** Every page of the report. */
async function report(): Promise<string> {
  assert.equal(await run(["report"], "empty"), 0, stderr);
  return readAllPages(join(cwd, "report"));
}

/** Every file under `dir`, relative to it. */
function files(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(dir.length + 1)) : [];
}

function read(path: string): string {
  return readFileSync(join(cwd, path), "utf8");
}

function assertNoLeak(text: string, where: string) {
  text = text.replace(/<style>[\s\S]*?<\/style>/g, ""); // CSS colours look like `#1d1d1f`
  for (const leak of LEAKS) assert.doesNotMatch(text, leak, `${where} leaks ${String(leak)}`);
}

describe("publish: full", () => {
  it("is the default for a public repo, and lists each delivered ticket's title and link", async () => {
    await collect("lifeline");
    const dataset = JSON.parse(read("datasets/grimfeld/lifeline.json")) as {
      publish: string;
      url: string;
      ticketList: { id: string; title: string; url: string; doneAt: string }[];
    };
    assert.equal(dataset.publish, "full");
    assert.equal(dataset.url, "https://github.com/grimfeld/lifeline");
    assert.deepEqual(dataset.ticketList.find((ticket) => ticket.id === "#106"), {
      id: "#106",
      title: "Lifeline issue title 106",
      url: "https://github.com/grimfeld/lifeline/issues/106",
      doneAt: "2026-10-28T12:00:00.000Z",
    });
    assert.deepEqual(dataset.ticketList.find((ticket) => ticket.id === "PR #136"), {
      id: "PR #136",
      title: "Lifeline PR title 136",
      url: "https://github.com/grimfeld/lifeline/pull/136",
      doneAt: dataset.ticketList.find((ticket) => ticket.id === "PR #136")?.doneAt,
    });

    const html = await report();
    // Throughput's table lists every delivered ticket.
    assert.match(html, /<td><a href="https:\/\/github\.com\/grimfeld\/lifeline\/issues\/106">#106<\/a><\/td><td>Lifeline issue title 106<\/td>/);
    assert.match(html, /<h1>grimfeld\/lifeline<\/h1><div class="chips">.*<a class="chip" href="https:\/\/github\.com\/grimfeld\/lifeline">GitHub<\/a>/);
  });

  it("applies to a private repo when the config says so", async () => {
    config({ publish: "full" });
    await collect("private");
    assert.equal((JSON.parse(read("datasets/acme-corp/payroll-engine.json")) as { publish: string }).publish, "full");
  });
});

describe("publish: anonymized", () => {
  it("is the default for a private repo: aggregates only, under the alias, in dataset and report", async () => {
    config({ alias: "client-a" });
    await collect("private");

    assert.deepEqual(files(join(cwd, "datasets")), ["client-a.json"]);
    const text = read("datasets/client-a.json");
    assertNoLeak(text, "the dataset");
    const dataset = JSON.parse(text) as { repo: string; publish: string; tickets: number; metrics: Record<string, { value: unknown }> };
    assert.equal(dataset.repo, "client-a");
    assert.equal(dataset.publish, "anonymized");
    assert.equal(dataset.tickets, 5);
    // The percentiles and the phases' aggregates stay; the per-ticket rows go.
    assert.deepEqual(dataset.metrics["leadTime"]?.value, {
      p50Hours: 12,
      p90Hours: 180,
      phases: { tickets: 5, queue: { p50Hours: 1, share: 0.092 }, work: { p50Hours: 0.5, share: 0.741 }, landing: { p50Hours: 9, share: 0.167 } },
    });
    assert.deepEqual(dataset.metrics["regressionRate"]?.value, { rate: 0.6, regressions: 4, regressedTickets: 3 });
    // Per-ticket rows go; the medians stay.
    for (const id of ["size", "estimateVsActual"]) {
      const value = dataset.metrics[id]?.value as { tickets: unknown[] } & Record<string, unknown>;
      assert.deepEqual(value.tickets, [], id);
      assert.ok(Object.keys(value).some((key) => key.startsWith("p50")), id);
    }

    const html = await report();
    assertNoLeak(html, "the report");
    assert.match(html, /<section class="repo" id="client-a" data-repo="client-a">/);
    assert.match(readPages(join(cwd, "report"), [repoPage("client-a")]), /<h1>client-a<\/h1>/);
    assert.doesNotMatch(html, /class="chip" href="https/);
    for (const file of files(join(cwd, "report"))) assertNoLeak(file, "a report path");
  });

  it("applies to a public repo when the config says so", async () => {
    config({ publish: "anonymized", alias: "side-project" });
    await collect("lifeline");
    assert.deepEqual(files(join(cwd, "datasets")), ["side-project.json"]);
    assert.doesNotMatch(read("datasets/side-project.json"), /lifeline|title|https?:/i);
  });

  it("removes the repo's full dataset left from an earlier collect", async () => {
    config({ publish: "full" });
    await collect("private");
    config({ publish: "anonymized", alias: "client-a" });
    await collect("private");
    assert.deepEqual(files(join(cwd, "datasets")), ["client-a.json"]);
  });

  it("refuses to collect without an alias", async () => {
    assert.equal(await run(["collect"], "private"), 1);
    assert.match(stderr, /alias/);
    assert.deepEqual(files(join(cwd, "datasets")), []);
  });

  it("refuses an alias that is not a plain name", async () => {
    config({ alias: "../acme-corp/x" });
    assert.equal(await run(["collect"], "private"), 1);
    assert.match(stderr, /alias/);
  });
});

describe("publish: none", () => {
  it("writes a local report and nothing to the datasets", async () => {
    config({ publish: "none" });
    mkdirSync(join(cwd, "datasets/acme-corp"), { recursive: true });
    writeFileSync(join(cwd, "datasets/acme-corp/payroll-engine.json"), "{}");
    await collect("private");

    assert.deepEqual(files(join(cwd, "datasets")), []);
    const local = read(`.agentic-metrics-local/${repoPage("acme-corp/payroll-engine")}`);
    const throughput = read(`.agentic-metrics-local/${metricPage("acme-corp/payroll-engine", "throughput")}`);
    assert.match(throughput, /<td><a href="https:\/\/github\.com\/acme-corp\/payroll-engine\/issues\/106">#106<\/a><\/td><td>Payroll issue title 106<\/td>/);
    assert.match(local, /data-metric="leadTime"/);
  });

  it("keeps the repo out of the published report", async () => {
    await collect("lifeline");
    config({ publish: "none" });
    await collect("private");
    const html = await report();
    assert.doesNotMatch(html, /acme-corp|payroll/i);
  });
});
