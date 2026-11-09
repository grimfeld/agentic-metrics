import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";
import { transcriptCache } from "../../cli/transcripts/source.ts";

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
  });
});
