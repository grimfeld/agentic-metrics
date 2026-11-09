import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { readRepo } from "./report-pages.ts";
import { fixtureSource } from "../../cli/github/source.ts";
import { transcriptCache } from "../../cli/transcripts/source.ts";

const GITHUB = join(import.meta.dirname, "../fixtures/github/lifeline");
const CACHE = join(import.meta.dirname, "../fixtures/transcript-cache/cost");
const NOW = new Date("2026-11-09T12:00:00Z");
const REPO_DIR = "/Users/dev/repos/lifeline";

// The cost transcript cache fixture, for the clone at /Users/dev/repos/lifeline:
//   C1 on `demo`, PR #115's head (#104 and #105): one Opus response written as
//      two lines (same message.id and usage), two Agent spawns (sub-agent c1…01
//      on Sonnet with a transcript, c2…02 on Haiku without one), a <synthetic>
//      placeholder. Sub-agent c1…01 has a usage with no 5m/1h cache-write split.
//   C2 on `type-editor-fields`, PR #116 (#106): two Haiku requests, one with a
//      prompt under 100k tokens, one over.
//   C3 in worktree `ticket-137` (PR #137): Opus in the US region with two web
//      searches, and a model the price table doesn't know.
//   C4 on master: orchestration.
// PR #136 has no transcript.
//
// Expected dollars, at the 2026-11-09 list prices (USD per million tokens):
//   C1 Opus:   1000·4 + 100000·8 (1h write) + 1000000·0.20 + 2000·20     = 1.044
//   c1 Sonnet: 2000·2 + 40000·2.50 (5m write) + 100000·0.10 + 1000·10    = 0.124
//   C2 Haiku:  50000·0.10 + 40000·0.01 + 2000·0.50      (90k prompt)   = 0.0064
//              10000·0.50 + 95000·0.05 + 2100·2.50      (105k prompt)  = 0.015
//   C3 Opus:   (1000·4 + 1000·20)·1.1 + 2 searches·$0.01                = 0.0464
//   C4 Opus:   500·4 + 500·20                                          = 0.012
const opusC1 = { model: "claude-opus-5-5", input: 1000, output: 2000, cacheCreation: 100000, cacheRead: 1000000, apiEquivalentUsd: 1.044 };
const sonnetC1 = { model: "claude-sonnet-5-5", input: 2000, output: 1000, cacheCreation: 40000, cacheRead: 100000, apiEquivalentUsd: 0.124 };

let cwd: string;
let stderr: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-cost-"));
  stderr = "";
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

async function run(argv: string[], repoDir = REPO_DIR) {
  const status = await main(argv, {
    cwd,
    github: fixtureSource(GITHUB),
    transcripts: transcriptCache({ dir: CACHE, repoDir }),
    now: () => NOW,
    stdout: () => undefined,
    stderr: (text) => (stderr += text),
  });
  assert.equal(status, 0, stderr);
}

function datasetText(repo = "grimfeld/lifeline"): string {
  return readFileSync(join(cwd, "datasets", `${repo}.json`), "utf8");
}

function metric(id: string, repo?: string): unknown {
  return (JSON.parse(datasetText(repo)) as { metrics: Record<string, unknown> }).metrics[id];
}

describe("delegation and cost", () => {
  it("counts sub-agents per ticket and the models they ran on", async () => {
    await run(["collect"]);

    const models = [
      { model: "claude-haiku-5-5", subAgents: 1 },
      { model: "claude-sonnet-5-5", subAgents: 1 },
    ];
    assert.deepEqual(metric("subAgents"), {
      value: {
        total: 2,
        p50: 0,
        p90: 2,
        models,
        perTicket: [
          { ticket: "#104", subAgents: 2, models },
          { ticket: "#105", subAgents: 2, models },
          { ticket: "#106", subAgents: 0, models: [] },
          { ticket: "PR #137", subAgents: 0, models: [] },
        ],
      },
      coverage: { tickets: 4, of: 5 },
    });
  });

  it("sums tokens per ticket and model, each API response once, and prices them as an API equivalent", async () => {
    await run(["collect"]);

    assert.deepEqual(metric("apiEquivalentCost"), {
      value: {
        priceTable: "2026-11-09",
        apiEquivalentUsd: 1.2358,
        unpricedModels: ["claude-future-9"],
        perTicketUsd: { p50: 1.168, p90: 1.168 },
        byModel: [
          { model: "claude-future-9", input: 100, output: 100, cacheCreation: 0, cacheRead: 0, apiEquivalentUsd: "unknown" },
          { model: "claude-haiku-5-5", input: 60000, output: 4100, cacheCreation: 0, cacheRead: 135000, apiEquivalentUsd: 0.0214 },
          { model: "claude-opus-5-5", input: 2000, output: 3000, cacheCreation: 100000, cacheRead: 1000000, apiEquivalentUsd: 1.0904 },
          sonnetC1,
        ],
        orchestration: {
          apiEquivalentUsd: 0.012,
          byModel: [{ model: "claude-opus-5-5", input: 500, output: 500, cacheCreation: 0, cacheRead: 0, apiEquivalentUsd: 0.012 }],
        },
        perTicket: [
          { ticket: "#104", apiEquivalentUsd: 1.168, byModel: [opusC1, sonnetC1] },
          { ticket: "#105", apiEquivalentUsd: 1.168, byModel: [opusC1, sonnetC1] },
          {
            ticket: "#106",
            apiEquivalentUsd: 0.0214,
            byModel: [{ model: "claude-haiku-5-5", input: 60000, output: 4100, cacheCreation: 0, cacheRead: 135000, apiEquivalentUsd: 0.0214 }],
          },
          {
            ticket: "PR #137",
            apiEquivalentUsd: "unknown",
            byModel: [
              { model: "claude-future-9", input: 100, output: 100, cacheCreation: 0, cacheRead: 0, apiEquivalentUsd: "unknown" },
              { model: "claude-opus-5-5", input: 1000, output: 1000, cacheCreation: 0, cacheRead: 0, apiEquivalentUsd: 0.0464 },
            ],
          },
        ],
      },
      coverage: { tickets: 4, of: 5 },
    });
  });

  it("reports both as unknown, not zero, when no transcript was read", async () => {
    await run(["collect"], "/Users/dev/repos/no-such-clone");

    assert.deepEqual(metric("subAgents"), { value: "unknown", coverage: { tickets: 0, of: 5 } });
    assert.deepEqual(metric("apiEquivalentCost"), { value: "unknown", coverage: { tickets: 0, of: 5 } });
  });

  it("keeps aggregates only when anonymized, and publishes no ids or text", async () => {
    writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify({ publish: "anonymized", alias: "side-project" }));
    await run(["collect"]);

    const text = datasetText("side-project");
    const metrics = (JSON.parse(text) as { metrics: Record<string, { value: Record<string, unknown> }> }).metrics;
    const delegation = metrics["subAgents"]?.value;
    const cost = metrics["apiEquivalentCost"]?.value;
    assert.equal(delegation?.["perTicket"], undefined);
    assert.equal(delegation?.["total"], 2);
    assert.equal(cost?.["perTicket"], undefined);
    assert.deepEqual([cost?.["apiEquivalentUsd"], cost?.["priceTable"]], [1.2358, "2026-11-09"]);
    for (const leak of [/SECRET/, /cccccccc-|c1000000000000001|c2000000000000002/, /msg_|req_|toolu_/, /\/Users\//, /#10\d|PR #/]) {
      assert.doesNotMatch(text, leak);
    }
  });

  it("labels the dollars API equivalent in the report and Methodology, with the price table used", async () => {
    await run(["collect"]);
    await run(["report"]);
    const html = readRepo(join(cwd, "report"), "grimfeld/lifeline");
    const text = (pattern: RegExp) => (pattern.exec(html)?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    const section = text(/data-section="apiEquivalentCost">([\s\S]*?)<\/section>/);
    assert.match(section, /^API-equivalent cost \$1\.24 API equivalent over the tickets with transcripts \(p50 \$1\.17, p90 \$1\.17 per ticket\), and \$0\.01 API equivalent on no ticket/);
    assert.match(section, /prices of 2026-11-09/);
    assert.match(section, /claude-future-9/);
    assert.match(text(/data-section="subAgents">([\s\S]*?)<\/section>/), /^Sub-agents per ticket 2 sub-agents/);
    const methodology = text(/data-methodology="apiEquivalentCost">([\s\S]*?)<\/article>/);
    assert.match(methodology, /API equivalent/);
    assert.match(methodology, /not (what was )?billed/);
  });
});
