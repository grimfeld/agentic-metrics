import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
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

async function collect() {
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
});
