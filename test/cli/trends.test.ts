import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";
import { transcriptCache } from "../../cli/transcripts/source.ts";
import { METRICS } from "../../cli/metrics/index.ts";

const GITHUB = join(import.meta.dirname, "../fixtures/github");
const CACHE = join(import.meta.dirname, "../fixtures/transcript-cache/lifeline");
const NOW = new Date("2026-11-09T12:00:00Z");
const REPO_DIR = "/Users/dev/repos/lifeline";

// The lifeline fixtures with their transcripts (see autonomy.test.ts):
//   delivered in October 2026: #104 (assisted), #105 (full, by label), PR #136 (manual), #106 (full);
//   delivered in November 2026: PR #137 (full).

interface FigureResult {
  value: number | "unknown";
  coverage: { tickets: number; of: number };
}
interface Dataset {
  trends: { periods: { period: string; tickets: number }[]; metrics: Record<string, FigureResult[]> };
  byAutonomy: Record<string, Record<"full" | "assisted" | "manual", FigureResult>>;
}

async function collect(cwd: string, config?: object) {
  if (config) writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify(config));
  let stderr = "";
  const status = await main(["collect"], {
    cwd,
    github: fixtureSource(join(GITHUB, "lifeline")),
    transcripts: transcriptCache({ dir: CACHE, repoDir: REPO_DIR }),
    now: () => NOW,
    stdout: () => undefined,
    stderr: (text) => (stderr += text),
  });
  assert.equal(status, 0, stderr);
}

async function report(cwd: string): Promise<string> {
  const status = await main(["report"], { cwd, github: fixtureSource(join(GITHUB, "empty")), now: () => NOW, stdout: () => undefined });
  assert.equal(status, 0);
  return readFileSync(join(cwd, "report/index.html"), "utf8");
}

let full: string;
let anonymized: string;
let dataset: Dataset;
let anonymizedDataset: Dataset;
let html: string;
let anonymizedHtml: string;

before(async () => {
  full = mkdtempSync(join(tmpdir(), "am-trends-"));
  await collect(full);
  dataset = JSON.parse(readFileSync(join(full, "datasets/grimfeld/lifeline.json"), "utf8")) as Dataset;
  html = await report(full);

  anonymized = mkdtempSync(join(tmpdir(), "am-trends-anon-"));
  await collect(anonymized, { publish: "anonymized", alias: "side-project" });
  anonymizedDataset = JSON.parse(readFileSync(join(anonymized, "datasets/side-project.json"), "utf8")) as Dataset;
  anonymizedHtml = await report(anonymized);
});

after(() => {
  rmSync(full, { recursive: true, force: true });
  rmSync(anonymized, { recursive: true, force: true });
});

describe("trends", () => {
  it("lists the months with deliveries, with their ticket counts", () => {
    assert.deepEqual(dataset.trends.periods, [
      { period: "2026-10", tickets: 4 },
      { period: "2026-11", tickets: 1 },
    ]);
  });

  it("gives each metric's figure per month, with its coverage within the month", () => {
    assert.deepEqual(dataset.trends.metrics["throughput"], [
      { value: 4, coverage: { tickets: 4, of: 4 } },
      { value: 1, coverage: { tickets: 1, of: 1 } },
    ]);
    // October: #104 and #105 (3 messages, one shared session), #106 (1); PR #136 has no transcript.
    assert.deepEqual(dataset.trends.metrics["humanMessagesPerTicket"], [
      { value: 3, coverage: { tickets: 3, of: 4 } },
      { value: 2, coverage: { tickets: 1, of: 1 } },
    ]);
  });

  it("gives every metric the CLI computes a trend", () => {
    assert.deepEqual(Object.keys(dataset.trends.metrics).sort(), METRICS.map((metric) => metric.id).sort());
  });

  it("keeps the same figures when anonymized", () => {
    assert.deepEqual(anonymizedDataset.trends, dataset.trends);
  });
});

describe("comparison by autonomy level", () => {
  it("gives each metric's figure over the tickets at each level, unknown where the level has no data", () => {
    assert.deepEqual(dataset.byAutonomy["humanMessagesPerTicket"], {
      full: { value: 2, coverage: { tickets: 3, of: 3 } },
      assisted: { value: 3, coverage: { tickets: 1, of: 1 } },
      manual: { value: "unknown", coverage: { tickets: 0, of: 1 } },
    });
    assert.deepEqual(dataset.byAutonomy["throughput"], {
      full: { value: 3, coverage: { tickets: 3, of: 3 } },
      assisted: { value: 1, coverage: { tickets: 1, of: 1 } },
      manual: { value: 1, coverage: { tickets: 1, of: 1 } },
    });
  });

  it("leaves out the metrics no ticket owns, and autonomy itself", () => {
    for (const id of ["autonomy", "orchestrationTime", "scheduledFailures", "batchHealth"]) assert.equal(dataset.byAutonomy[id], undefined, id);
  });

  it("keeps the same figures when anonymized", () => {
    assert.deepEqual(anonymizedDataset.byAutonomy, dataset.byAutonomy);
  });
});

/** The visible text of the first element carrying `attribute="value"` in `page`. */
function textOf(page: string, attribute: string, value: string): string {
  const match = new RegExp(`<(\\w+)[^>]* ${attribute}="${value}"[^>]*>([\\s\\S]*?)</\\1>`).exec(page);
  assert.ok(match, `no element with ${attribute}="${value}"`);
  return (match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** The CV sentences of a page, keyed by their `data-sentence`, as the Copy button copies them. */
function sentences(page: string): Map<string, string> {
  const items = [...page.matchAll(/<li data-sentence="([^"]+)"><p class="sentence">([^<]*)<\/p><button type="button" data-copy="([^"]*)">Copy<\/button><\/li>/g)];
  return new Map(
    items.map((item) => {
      assert.equal(item[2], item[3], "the Copy button copies the sentence shown");
      return [item[1] ?? "", item[2] ?? ""];
    }),
  );
}

describe("report: trends", () => {
  it("shows a row per metric, a column per month, each figure with its coverage", () => {
    assert.equal(textOf(html, "data-trend", "periods"), "Metric 2026-10 4 tickets 2026-11 1 ticket");
    assert.equal(textOf(html, "data-trend", "humanMessagesPerTicket"), "Human messages per ticket p50 3 3 of 4 2 1 of 1");
    assert.equal(textOf(html, "data-trend", "leadTime"), "Lead time p50 12 h 4 of 4 10 h 1 of 1");
    assert.equal(textOf(html, "data-trend", "estimateVsActual"), "Estimate vs actual p50 actual / estimate 0.31 2 of 4 unknown 0 of 1");
    for (const metric of METRICS) assert.match(html, new RegExp(`data-trend="${metric.id}"`), metric.id);
  });
});

describe("report: comparison by autonomy level", () => {
  it("shows each metric's figure per level, with its coverage", () => {
    assert.equal(textOf(html, "data-autonomy", "levels"), "Metric Full 3 tickets Assisted 1 ticket Manual 1 ticket");
    assert.equal(textOf(html, "data-autonomy", "humanMessagesPerTicket"), "Human messages per ticket p50 2 3 of 3 3 1 of 1 unknown 0 of 1");
    assert.equal(textOf(html, "data-autonomy", "regressionRate"), "Regression rate of tickets 33.3% 3 of 3 100% 1 of 1 100% 1 of 1");
    assert.doesNotMatch(html, /data-autonomy="orchestrationTime"/);
  });
});

describe("report: CV-ready sentences", () => {
  it("quotes each known metric with its coverage", () => {
    const all = sentences(html);
    assert.equal(all.get("humanMessagesPerTicket"), "A median of 2 human messages per ticket (p90 3), over 4 of 5 tickets.");
    assert.equal(
      all.get("leadTime"),
      "Median lead time of 12 h from a ticket being ready to its last PR merging (p90 7.5 d), over 5 of 5 tickets.",
    );
  });

  it("compares the fully autonomous tickets with the other levels that are known", () => {
    assert.equal(
      sentences(html).get("humanMessagesPerTicket:autonomy"),
      "Human messages per ticket (p50): 2 on fully autonomous tickets (3 of 3 tickets), against 3 on assisted ones (1 of 1 tickets).",
    );
  });

  it("states the trend from the first known month to the last", () => {
    assert.equal(
      sentences(html).get("leadTime:trend"),
      "Lead time (p50) went from 12 h in October 2026 (4 of 4 tickets) to 10 h in November 2026 (1 of 1 tickets).",
    );
  });

  it("never turns an unknown into a sentence", () => {
    const all = sentences(html);
    assert.ok(all.size > 0);
    for (const id of ["firstRunCiRate", "fixCycles", "scheduledFailures", "batchHealth"]) {
      assert.ok(![...all.keys()].some((key) => key.split(":")[0] === id), id);
    }
    assert.equal(all.get("estimateVsActual:trend"), undefined, "one known month is no trend");
    for (const text of all.values()) assert.doesNotMatch(text, /unknown/);
  });

  it("are written for an anonymized repo too, from its aggregates", () => {
    assert.equal(sentences(anonymizedHtml).get("humanMessagesPerTicket"), "A median of 2 human messages per ticket (p90 3), over 4 of 5 tickets.");
    assert.match(anonymizedHtml, /data-trend="leadTime"/);
    assert.match(anonymizedHtml, /data-autonomy="leadTime"/);
  });
});
