import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { formatHours } from "./stats.ts";
import { IDLE_CAP_MS } from "../transcripts/load.ts";

export interface OrchestrationTime {
  /** Active hours of the main sessions that named no work. */
  hours: number;
  /** Those main sessions. */
  sessions: number;
  /** Sub-agents linked to no work: spawned by those sessions, or naming none themselves. */
  subAgents: number;
  /** Human messages in those sessions. */
  humanMessages: number;
}

export const orchestrationTime: Metric<OrchestrationTime> = {
  id: "orchestrationTime",
  name: "Orchestration time",

  compute({ tickets, transcripts }) {
    // How complete the transcripts are: the tickets that have any.
    const coverage = { tickets: tickets.filter((ticket) => ticket.sessions.length > 0).length, of: tickets.length };
    if (transcripts.sessions === 0) return { value: UNKNOWN, coverage };
    const main = transcripts.orchestration.filter((session) => session.agentId === undefined);
    const activeMs = main.reduce((sum, session) => sum + session.activeMs, 0);
    return {
      value: {
        hours: Math.round((activeMs / 3_600_000) * 10) / 10,
        sessions: main.length,
        subAgents: transcripts.orchestration.length - main.length,
        humanMessages: new Set(main.flatMap((session) => session.humanMessages)).size,
      },
      coverage,
    };
  },

  // Repo-level only: nothing per ticket to drop.
  anonymize: (value) => value,

  section({ hours, sessions, subAgents, humanMessages }) {
    const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? "" : "s"}`;
    return `<p>${formatHours(hours)} in ${plural(sessions, "session")} on no ticket, with ${plural(humanMessages, "human message")} and ${plural(subAgents, "sub-agent")}.</p>`;
  },

  methodology: {
    definition: `Active time of the Claude Code sessions linked to no ticket: those on the default branch, or any branch naming no issue, that opened no ticket's PR (grilling, planning, orchestrating sub-agents, landing batches). Active time adds the gaps between a session's consecutive transcript lines, each capped at ${String(IDLE_CAP_MS / 60_000)} minutes, so a session left open overnight counts only while in use. Sub-agents' time is not added (they run in parallel); they are counted. Sessions on a branch naming work that is not delivered count neither here nor on a ticket.`,
    limits:
      "Only sessions whose transcripts were cached locally count; coverage gives the tickets that have transcripts, as a measure of how complete they are. A ticket worked on from a session on the default branch, without a ticket branch or PR of its own, counts here. Time spent reading or thinking without the session writing anything for over the cap is not counted.",
  },
};
