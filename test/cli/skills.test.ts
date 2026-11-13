// Skill usage per ticket, and each metric compared with and without a skill.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../../cli/dataset.ts";
import type { LinkedWork, Ticket } from "../../cli/linker.ts";
import { skills } from "../../cli/metrics/skills.ts";
import { loadSessions, type Session } from "../../cli/transcripts/load.ts";

const t = (minute: number) => `2026-11-10T18:${String(minute).padStart(2, "0")}:00Z`;

/** A session that types /grill-with-docs (a skill), types /clear (not one), and has Claude invoke `grilling`. */
const LINES = [
  { type: "user", uuid: "u1", sessionId: "s1", timestamp: t(0), origin: { kind: "human" }, message: { role: "user", content: "<command-message>grill-with-docs</command-message>\n<command-name>/grill-with-docs</command-name>" } },
  { type: "user", uuid: "u2", sessionId: "s1", timestamp: t(0), isMeta: true, message: { role: "user", content: [{ type: "text", text: "Base directory for this skill: /x/grill-with-docs\n\nDo it." }] } },
  { type: "user", uuid: "u3", sessionId: "s1", timestamp: t(1), origin: { kind: "human" }, message: { role: "user", content: "<command-name>/clear</command-name>" } },
  { type: "assistant", uuid: "a1", sessionId: "s1", timestamp: t(2), message: { id: "m1", role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "Skill", input: { skill: "grilling" } }] } },
];

function session(): Session {
  const [loaded] = loadSessions([{ session: "s1", lines: LINES }]);
  assert.ok(loaded);
  return loaded;
}

function work(sessionsPerTicket: Session[][]): LinkedWork {
  const tickets = sessionsPerTicket.map(
    (sessions, index) =>
      ({ id: `#${String(index + 1)}`, sessions, pullRequests: [], integrationPullRequests: [], batchCommits: [], doneAt: new Date("2026-11-10T20:00:00Z"), readyAt: undefined, issue: undefined, autonomy: { level: "full", computed: "full", overridden: false } }) as unknown as Ticket,
  );
  return { tickets, pullRequests: [], integrationPullRequests: [], regressions: [], ci: { defaultBranch: "main", mainWorkflow: undefined, runs: [] }, transcripts: { sessions: 1, orchestration: [] } };
}

describe("skill usage", () => {
  it("counts a typed skill and one Claude invoked, with their origin, and no built-in command", () => {
    assert.deepEqual(session().skills, [
      { id: "u1", name: "grill-with-docs", typed: true },
      { id: "tool-1", name: "grilling", typed: false },
    ]);
  });

  it("lists the skills per ticket, and each skill's tickets", () => {
    const value = skills.compute(work([[session()], [{ ...session(), skills: [] }]])).value;

    assert.deepEqual(value, {
      p50: 0,
      mean: 1,
      skills: [
        { name: "grill-with-docs", tickets: 1, typed: 1, invoked: 0 },
        { name: "grilling", tickets: 1, typed: 0, invoked: 1 },
      ],
      perTicket: [
        { ticket: "#1", skills: ["grill-with-docs", "grilling"] },
        { ticket: "#2", skills: [] },
      ],
    });
  });

  it("compares the metrics with and without a skill used on 5 tickets or more, and not one used on 4", () => {
    const used = (count: number) => [...Array.from({ length: count }, () => [session()]), [{ ...session(), skills: [] }]];
    const repo = { fullName: "grimfeld/x", url: "", private: false, defaultBranch: "main" };
    const five = buildDataset(repo, work(used(5)), new Date(), "full").bySkill ?? {};
    const four = buildDataset(repo, work(used(4)), new Date(), "full").bySkill ?? {};

    assert.deepEqual(Object.keys(five), ["grill-with-docs", "grilling"]);
    const grilling = five["grilling"];
    assert.ok(grilling);
    assert.equal(grilling.tickets, 5);
    const compared = grilling.metrics["humanMessagesPerTicket"];
    assert.ok(compared);
    assert.deepEqual(compared.with.coverage, { tickets: 5, of: 5 });
    assert.deepEqual(compared.without.coverage, { tickets: 1, of: 1 });
    assert.deepEqual(four, {});
  });

  it("names no skill in an anonymized dataset", () => {
    const repo = { fullName: "grimfeld/x", url: "", private: true, defaultBranch: "main" };
    const dataset = buildDataset(repo, work(Array.from({ length: 6 }, () => [session()])), new Date(), "anonymized", "client-a");

    assert.equal(dataset.bySkill, undefined);
    assert.deepEqual(dataset.metrics["skills"]?.value, { p50: 2, mean: 2 });
    assert.doesNotMatch(JSON.stringify(dataset), /grill/);
  });
});
