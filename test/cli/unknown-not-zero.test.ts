import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";
import { transcriptCache } from "../../cli/transcripts/source.ts";
import { readMetricPages, readRepo } from "./report-pages.ts";

const GITHUB = join(import.meta.dirname, "../fixtures/github");
const BATCH_CACHE = join(import.meta.dirname, "../fixtures/transcript-cache/batch");
const NOW = new Date("2026-11-09T12:00:00Z");

interface Result {
  value: unknown;
  coverage: { tickets: number; of: number };
}

interface Dataset {
  metrics: Record<string, Result>;
  trends: { metrics: Record<string, Result[]> };
  byAutonomy: Record<string, Record<string, Result>>;
}

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-unknown-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

async function run(argv: string[], github: string, transcripts?: { dir: string; repoDir: string }): Promise<void> {
  let stderr = "";
  const status = await main(argv, {
    cwd,
    github: fixtureSource(github),
    ...(transcripts ? { transcripts: transcriptCache(transcripts) } : {}),
    now: () => NOW,
    stdout: () => undefined,
    stderr: (text) => (stderr += text),
  });
  assert.equal(status, 0, stderr);
}

function dataset(repo: string): Dataset {
  return JSON.parse(readFileSync(join(cwd, "datasets", `${repo}.json`), "utf8")) as Dataset;
}

/** The repo's report page, then Methodology. */
function report(repo = "grimfeld/agentic-metrics"): string {
  return readRepo(join(cwd, "report"), repo);
}

/** A metric's page of the repo. */
function metricPage(id: string, repo = "grimfeld/agentic-metrics"): string {
  return readMetricPages(join(cwd, "report"), repo, [id]);
}

/** The visible text of the first element carrying `attribute="value"`, or undefined. */
function textOf(html: string, attribute: string, value: string): string | undefined {
  const match = new RegExp(`<(\\w+)[^>]* ${attribute}="${value}"[^>]*>([\\s\\S]*?)</\\1>`).exec(html);
  return match?.[2]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The batch fixture with integration PR #22's commits gone, and PR #30
 * (`ticket-19`) excluded: all 5 tickets are delivered by #22 alone, and none
 * has a diff of its own.
 */
function batchWithoutDiffs(): string {
  const github = join(cwd, "github");
  cpSync(join(GITHUB, "batch"), github, { recursive: true });
  const file = join(github, "pull-requests.json");
  const pages = JSON.parse(readFileSync(file, "utf8")) as {
    data: { repository: { pullRequests: { nodes: { number: number; commits: { totalCount: number; nodes: unknown[] } }[] } } };
  }[];
  for (const pr of pages.flatMap((page) => page.data.repository.pullRequests.nodes)) {
    if (pr.number === 22) pr.commits = { totalCount: 0, nodes: [] };
  }
  writeFileSync(file, JSON.stringify(pages));
  writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify({ exclude: { branches: ["ticket-"] } }));
  return github;
}

describe("unknown, not zero", () => {
  it("reports net lines as unknown when no ticket has a diff of its own, in the dataset, its trends and by autonomy level", async () => {
    await run(["collect"], batchWithoutDiffs());
    const data = dataset("grimfeld/agentic-metrics");

    assert.deepEqual(data.metrics["netLinesRemoved"], { value: "unknown", coverage: { tickets: 0, of: 5 } });
    const trend = data.trends.metrics["netLinesRemoved"] ?? [];
    assert.ok(trend.length > 0);
    for (const result of trend) assert.equal(result.value, "unknown");
    for (const result of Object.values(data.byAutonomy["netLinesRemoved"] ?? {})) assert.equal(result.value, "unknown");
  });

  it("renders net lines over no ticket as unknown, and quotes no sentence about it", async () => {
    await run(["collect"], batchWithoutDiffs());
    await run(["report"], join(GITHUB, "batch"));
    const html = report();
    const page = metricPage("netLinesRemoved");

    assert.equal(textOf(page, "data-section", "netLinesRemoved"), "Summary unknown");
    assert.match(textOf(page, "data-section", "trend") ?? "", / unknown 0 of 5$/);
    assert.equal(textOf(page, "data-section", "chart"), "Net lines changed by month unknown");
    assert.doesNotMatch(page, /<svg class="chart"/);
    assert.equal(textOf(html, "data-sentence", "netLinesRemoved"), undefined);
    assert.equal(textOf(html, "data-sentence", "netLinesRemoved:trend"), undefined);
  });

  it("reports orchestration time as unknown, not 0 h, when no orchestration session has measured activity", async () => {
    // The batch cache holds a single session, on `ticket-2`: there is no orchestration session at all.
    await run(["collect"], join(GITHUB, "batch"), { dir: BATCH_CACHE, repoDir: "/Users/dev/repos/agentic-metrics" });
    const data = dataset("grimfeld/agentic-metrics");

    assert.deepEqual(data.metrics["orchestrationTime"], { value: "unknown", coverage: { tickets: 1, of: 5 } });
    for (const result of data.trends.metrics["orchestrationTime"] ?? []) assert.equal(result.value, "unknown");

    await run(["report"], join(GITHUB, "batch"));
    const html = report();
    const page = metricPage("orchestrationTime");
    assert.equal(textOf(page, "data-section", "orchestrationTime"), "Summary unknown");
    assert.equal(textOf(page, "data-section", "chart"), "Orchestration time by month unknown");
    assert.doesNotMatch(page, /<svg class="chart"/);
    assert.equal(textOf(html, "data-sentence", "orchestrationTime"), undefined);
    assert.match(textOf(html, "data-methodology", "orchestrationTime") ?? "", /unknown, not 0 h, when no session linked to no ticket has measured activity/);
  });

  it("renders a value over 0 tickets, and orchestration with no measured activity, as unknown in a dataset written before they were", async () => {
    await run(["collect"], join(GITHUB, "lifeline"));
    // As this repo's own dataset was published before #33: zeros over no ticket, and 0 h of orchestration.
    const file = join(cwd, "datasets", "grimfeld/lifeline.json");
    const data = JSON.parse(readFileSync(file, "utf8")) as Dataset;
    const of = data.metrics["leadTime"]?.coverage.of ?? 0;
    data.metrics["netLinesRemoved"] = { value: { linesAdded: 0, linesDeleted: 0, netLinesRemoved: 0, ticketsNetRemoving: 0, tickets: [] }, coverage: { tickets: 0, of } };
    data.metrics["orchestrationTime"] = { value: { hours: 0, sessions: 0, subAgents: 0, humanMessages: 0 }, coverage: { tickets: 2, of } };
    data.trends.metrics["netLinesRemoved"] = (data.trends.metrics["netLinesRemoved"] ?? []).map(({ coverage }) => ({ value: 0, coverage: { ...coverage, tickets: 0 } }));
    data.trends.metrics["orchestrationTime"] = (data.trends.metrics["orchestrationTime"] ?? []).map(({ coverage }) => ({ value: 0, coverage }));
    const levels = data.byAutonomy["netLinesRemoved"] ?? {};
    for (const level of Object.keys(levels)) levels[level] = { value: 0, coverage: { tickets: 0, of: 1 } };
    writeFileSync(file, JSON.stringify(data));
    await run(["report"], join(GITHUB, "lifeline"));
    const html = report("grimfeld/lifeline");

    assert.match(textOf(html, "data-metric", "netLinesRemoved") ?? "", /^Net lines changed unknown 0 of \d+ tickets$/);
    assert.match(textOf(html, "data-metric", "orchestrationTime") ?? "", /^Orchestration time unknown /);
    for (const key of ["netLinesRemoved", "netLinesRemoved:trend", "netLinesRemoved:autonomy", "orchestrationTime", "orchestrationTime:trend"]) {
      assert.equal(textOf(html, "data-sentence", key), undefined, key);
    }
    const net = metricPage("netLinesRemoved", "grimfeld/lifeline");
    assert.equal(textOf(net, "data-section", "netLinesRemoved"), "Summary unknown");
    assert.match(textOf(net, "data-section", "trend") ?? "", /Tickets Oct 2026 unknown 0 of 4 Nov 2026 unknown 0 of 1$/);
    assert.equal(textOf(metricPage("orchestrationTime", "grimfeld/lifeline"), "data-section", "orchestrationTime"), "Summary unknown");
  });

  it("never publishes a known figure over 0 tickets, in any fixture", async () => {
    const root = cwd;
    const fixtures = [
      ["lifeline", "grimfeld/lifeline"],
      ["batch", "grimfeld/agentic-metrics"],
      ["ci", "grimfeld/ci"],
      ["empty", "grimfeld/agentic-metrics"],
    ] as const;
    for (const [fixture, repo] of fixtures) {
      cwd = mkdtempSync(join(root, `${fixture}-`));
      await run(["collect"], join(GITHUB, fixture));
      const data = dataset(repo);
      const results: [string, Result][] = [
        ...Object.entries(data.metrics),
        ...Object.entries(data.trends.metrics).flatMap(([id, results]) => results.map((result) => [`${id} trend`, result] as [string, Result])),
        ...Object.entries(data.byAutonomy).flatMap(([id, levels]) => Object.entries(levels).map(([level, result]) => [`${id} ${level}`, result] as [string, Result])),
      ];
      for (const [what, result] of results) {
        if (result.coverage.tickets === 0) assert.equal(result.value, "unknown", `${fixture} ${what}`);
      }
    }
    cwd = root;
  });
});

describe("net lines changed", () => {
  it("shows net lines as lines changed with a sign, in the section, the CV sentences, the trends and Methodology; the dataset keeps its id", async () => {
    await run(["collect"], join(GITHUB, "lifeline"));
    await run(["report"], join(GITHUB, "lifeline"));
    const html = `${report("grimfeld/lifeline")}\n${metricPage("netLinesRemoved", "grimfeld/lifeline")}`;

    // #115 +120/-30, #116 +50/-70, #117 +10/-40, #136 +200/-5, #137 +5/-0: 385 added, 145 deleted.
    assert.equal(dataset("grimfeld/lifeline").metrics["netLinesRemoved"]?.coverage.tickets, 5);
    // The section's wording is checked in report.test.ts.
    assert.equal(
      textOf(html, "data-sentence", "netLinesRemoved"),
      "Net lines changed: +240 (385 added, 145 deleted); 1 ticket removed more code than it added, over 5 of 5 tickets. Copy",
    );
    assert.match(textOf(html, "data-section", "trend") ?? "", /Net lines changed \(net\) Tickets Oct 2026 \+235 4 of 4 Nov 2026 \+5 1 of 1$/);
    assert.match(textOf(html, "data-methodology", "netLinesRemoved") ?? "", /^Net lines changed Lines added minus lines deleted/);
    assert.doesNotMatch(html, /[Nn]et lines removed|[Nn]et removed/);
  });

  it("formats large counts with a thousands separator", async () => {
    const github = join(cwd, "github");
    cpSync(join(GITHUB, "lifeline"), github, { recursive: true });
    const file = join(github, "pull-requests.json");
    writeFileSync(file, readFileSync(file, "utf8").replace(/"additions":\s*200\b/, '"additions": 102990'));
    await run(["collect"], github);
    await run(["report"], github);

    assert.match(textOf(metricPage("netLinesRemoved", "grimfeld/lifeline"), "data-section", "netLinesRemoved") ?? "", /^Summary \+103,030 net lines changed: 103,175 added, 145 deleted\./);
  });
});
