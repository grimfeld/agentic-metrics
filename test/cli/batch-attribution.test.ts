import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { readRepo } from "./report-pages.ts";
import { fixtureSource } from "../../cli/github/source.ts";
import { transcriptCache } from "../../cli/transcripts/source.ts";

const GITHUB = join(import.meta.dirname, "../fixtures/github/batch");
const CACHE = join(import.meta.dirname, "../fixtures/transcript-cache/batch");
const NOW = new Date("2026-11-09T12:00:00Z");
const REPO_DIR = "/Users/dev/repos/agentic-metrics";

// The batch fixtures, shaped on this repo's PR #22: integration PR #22
// (`integration/spec-1` into `main`) closes #2, #16, #17, #18 and #19. Its commits:
//   c01 toolchain, on the batch line, no reference: nobody's;
//   c02, c03 (no reference) brought in by c04 `Merge ticket-2: … (#2)`: #2 by merge subject;
//   c05 `… (#18)` on the batch line: #18 by `(#N)`;
//   c06 and c07 (a sync merge of the batch into the ticket branch) brought in by
//      c08 `Merge branch 'feat/16-action' …`: #16 by branch name;
//   c09 `… (#19)` brought in by c10 `Merge pull request #30 from grimfeld/ticket-19`:
//      #19, which also has PR #30 of its own;
//   c11, c12 (c12 by hand, no trailer) brought in by c13 `Merge ticket-17: … (#17)`: #17;
//   c14 brought in by c15 `Merge review-fixes: …`: nobody's.
// Every commit but c01 and c12 is co-authored by Claude. Only #2 has a transcript
// (a session on `ticket-2`, one human message).

let cwd: string;
let stderr: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-batch-"));
  stderr = "";
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

async function collect(config?: object) {
  if (config) writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify(config));
  const status = await main(["collect"], {
    cwd,
    github: fixtureSource(GITHUB),
    transcripts: transcriptCache({ dir: CACHE, repoDir: REPO_DIR }),
    now: () => NOW,
    stdout: () => undefined,
    stderr: (text) => (stderr += text),
  });
  assert.equal(status, 0, stderr);
  return JSON.parse(readFileSync(join(cwd, "datasets/grimfeld/agentic-metrics.json"), "utf8")) as {
    metrics: Record<string, { value: unknown; coverage: unknown }>;
  };
}

/** The throughput CV sentence of the report rendered from the collected dataset. */
async function throughputSentence(): Promise<string | undefined> {
  const status = await main(["report"], { cwd, github: fixtureSource(GITHUB), now: () => NOW, stdout: () => undefined });
  assert.equal(status, 0);
  const html = readRepo(join(cwd, "report"), "grimfeld/agentic-metrics");
  return /<li data-sentence="throughput"><p class="sentence">([^<]*)<\/p>/.exec(html)?.[1];
}

function perTicket<Row extends { ticket: string }>(rows: Row[]): Record<string, Omit<Row, "ticket">> {
  return Object.fromEntries(rows.map(({ ticket, ...rest }) => [ticket, rest]));
}

describe("a batch's commits credited to the tickets it delivers", () => {
  it("classifies batch-delivered tickets by the commits attributed to them", async () => {
    const dataset = await collect();
    const value = dataset.metrics["autonomy"]?.value as { perTicket: { ticket: string; computed: string }[] };
    assert.deepEqual(
      Object.fromEntries(value.perTicket.map((row) => [row.ticket, row.computed])),
      {
        "#2": "full", // by merge subject, with a transcript
        "#18": "assisted", // by `(#N)`, no transcript
        "#16": "assisted", // by branch name, no transcript
        "#17": "assisted", // one commit by hand
        "#19": "assisted", // its own PR, no transcript
      },
    );
  });

  it("counts attributed commits in a ticket's diff only when it has no PR of its own; merges and unattributed commits count nowhere", async () => {
    const dataset = await collect();
    const size = dataset.metrics["size"] as { value: { tickets: { ticket: string; diffLines: number; filesTouched: number }[] }; coverage: unknown };
    assert.deepEqual(size.coverage, { tickets: 5, of: 5 });
    assert.deepEqual(perTicket(size.value.tickets), {
      "#2": { diffLines: 67, filesTouched: 5, subTickets: 0 }, // c02, c03
      "#18": { diffLines: 33, filesTouched: 3, subTickets: 0 }, // c05
      "#16": { diffLines: 44, filesTouched: 2, subTickets: 0 }, // c06; the sync merge c07 is not its work
      "#17": { diffLines: 32, filesTouched: 3, subTickets: 0 }, // c11, c12
      "#19": { diffLines: 20, filesTouched: 2, subTickets: 0 }, // PR #30 only, not c09 again
    });

    const net = dataset.metrics["netLinesRemoved"] as { value: { linesAdded: number; linesDeleted: number }; coverage: unknown };
    assert.deepEqual(net.coverage, { tickets: 5, of: 5 });
    // c01 (100 lines) and c14 (7 + 7), attributed to nobody, are not in the totals.
    assert.equal(net.value.linesAdded, 180);
    assert.equal(net.value.linesDeleted, 16);
  });

  it("times a batch-delivered ticket from the first commit attributed to it", async () => {
    // #18 is estimated at 1d; c05 was authored on Nov 3 09:00 and the batch merged on Nov 6 09:00.
    const dataset = await collect();
    const value = dataset.metrics["estimateVsActual"]?.value as { tickets: { ticket: string; actualHours: number; ratio: number }[] };
    assert.deepEqual(
      value.tickets.map(({ ticket, actualHours, ratio }) => ({ ticket, actualHours, ratio })),
      [{ ticket: "#18", actualHours: 72, ratio: 3 }],
    );
  });

  it("words throughput with correct plurals", async () => {
    await collect();
    assert.match((await throughputSentence()) ?? "", /^Delivered 5 tickets in 1 pull request over 1 week\b/);
  });

  it("says so when every ticket came through integration PRs", async () => {
    // PR #30 excluded: #19 too is delivered by the batch alone.
    await collect({ exclude: { branches: ["ticket-"] } });
    assert.match((await throughputSentence()) ?? "", /^Delivered 5 tickets, all through integration pull requests, over 1 week\b/);
  });
});
