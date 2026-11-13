// Interrupts, tool errors, refusals and compactions, read from transcripts.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AutonomyThresholds } from "../../cli/config.ts";
import { classifyAutonomy } from "../../cli/autonomy.ts";
import type { LinkedWork, Ticket } from "../../cli/linker.ts";
import { friction } from "../../cli/metrics/friction.ts";
import { humanMessagesPerTicket } from "../../cli/metrics/human-messages.ts";
import { loadSessions, type Session } from "../../cli/transcripts/load.ts";

const t = (minute: number) => `2026-11-10T18:${String(minute).padStart(2, "0")}:00Z`;
const user = (uuid: string, minute: number, content: unknown) => ({ type: "user", uuid, sessionId: "s1", timestamp: t(minute), message: { role: "user", content } });
const result = (id: string, text: string, error = true) => ({ type: "tool_result", tool_use_id: id, content: text, is_error: error });

/** One session: a prompt, an interrupt, a failed and a refused tool call, a compaction; its interrupt written twice, as a resumed session does. */
const LINES = [
  { ...user("u1", 0, "Implement it"), origin: { kind: "human" } },
  user("u2", 1, [{ type: "text", text: "[Request interrupted by user]" }]),
  user("u2", 1, [{ type: "text", text: "[Request interrupted by user]" }]),
  user("u3", 2, [result("tool-1", "Exit code 1\nfailed")]),
  user("u4", 3, [result("tool-2", "The user doesn't want to proceed with this tool use. The tool use was rejected.")]),
  user("u5", 3, [{ type: "text", text: "[Request interrupted by user for tool use]" }]),
  user("u6", 4, [result("tool-3", "ok", false)]),
  { type: "system", subtype: "compact_boundary", uuid: "c1", sessionId: "s1", timestamp: t(5) },
];

const session = (): Session => {
  const [loaded] = loadSessions([{ session: "s1", lines: LINES }]);
  assert.ok(loaded);
  return loaded;
};

function work(sessions: Session[][]): LinkedWork {
  const tickets = sessions.map((list, index) => ({ id: `#${String(index + 1)}`, sessions: list, pullRequests: [{ commits: [{ claudeCoAuthor: true }], labels: [] }], batchCommits: [] }) as unknown as Ticket);
  return { tickets, transcripts: { sessions: 1, orchestration: [] } } as unknown as LinkedWork;
}

describe("friction", () => {
  it("reads each kind once: an interrupt is not a refusal, and neither is a human message", () => {
    const { friction: found, humanMessages } = session();

    assert.deepEqual(found, { interrupts: ["u2"], toolErrors: ["tool-1"], denials: ["tool-2"], compactions: ["c1"] });
    assert.deepEqual(humanMessages, ["u1"]);
  });

  it("gives per-ticket counts, and leaves a ticket known only through records out, not at zero", () => {
    const recorded = { ...session(), friction: undefined, recorded: { parent: undefined } };
    const value = friction.compute(work([[session()], [recorded]])).value;

    assert.deepEqual(value, {
      p50: { toolErrors: 1, denials: 1, compactions: 1 },
      totals: { toolErrors: 1, denials: 1, compactions: 1 },
      perTicket: [{ ticket: "#1", toolErrors: 1, denials: 1, compactions: 1 }],
    });
    assert.deepEqual(friction.compute(work([[recorded]])).value, "unknown");
  });

  it("shows interrupts beside human messages", () => {
    const value = humanMessagesPerTicket.compute(work([[session()]])).value;
    assert.notEqual(value, "unknown");
    if (value === "unknown") return;

    assert.deepEqual(value.interrupts, { p50: 1, total: 1, tickets: 1 });
    assert.deepEqual(value.perTicket, [{ ticket: "#1", messages: 1, interrupts: 1 }]);
  });

  it("changes no autonomy level unless the repo sets fullMaxInterrupts", () => {
    const level = (thresholds: AutonomyThresholds) => classifyAutonomy(work([[session()]]), thresholds).tickets[0]?.autonomy?.computed;

    assert.equal(level({ fullMaxFollowUps: 1, fullMinClaudeCommitShare: 1 }), "full");
    assert.equal(level({ fullMaxFollowUps: 1, fullMinClaudeCommitShare: 1, fullMaxInterrupts: 1 }), "full");
    assert.equal(level({ fullMaxFollowUps: 1, fullMinClaudeCommitShare: 1, fullMaxInterrupts: 0 }), "assisted");
  });
});
