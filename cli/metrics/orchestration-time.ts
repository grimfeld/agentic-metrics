import { trendLine } from "../report/charts.ts";
import type { Figure, Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { formatHours, msToHours, plural, round } from "./stats.ts";
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

// Repo level: no ticket, so no autonomy level, owns it.
const ORCHESTRATION_FIGURE: Figure<OrchestrationTime> = { label: "active", of: ({ hours }) => hours, format: formatHours, byAutonomy: false };

export const orchestrationTime: Metric<OrchestrationTime> = {
  id: "orchestrationTime",
  name: "Orchestration time",

  compute({ tickets, transcripts }) {
    // How complete the transcripts are: the tickets that have any.
    const coverage = { tickets: tickets.filter((ticket) => ticket.sessions.length > 0).length, of: tickets.length };
    if (transcripts.sessions === 0) return { value: UNKNOWN, coverage };
    const main = transcripts.orchestration.filter((session) => session.agentId === undefined);
    const activeMs = main.reduce((sum, session) => sum + session.activeMs, 0);
    // No orchestration session, or none with two timed lines: nothing was measured, which is not 0 h.
    if (activeMs === 0) return { value: UNKNOWN, coverage };
    // Sub-agents with a session of their own here, and those a session read from records says it spawned.
    const subAgents = new Set(transcripts.orchestration.flatMap((session) => (session.agentId === undefined ? [] : [session.agentId])));
    for (const session of main) if (session.recorded) for (const spawn of session.spawns) subAgents.add(spawn.agentId);
    return {
      value: {
        hours: round(msToHours(activeMs), 1),
        sessions: main.length,
        subAgents: subAgents.size,
        humanMessages: new Set(main.flatMap((session) => session.humanMessages)).size,
      },
      coverage,
    };
  },

  // Older datasets wrote 0 h over no session; a known value always has one.
  repoLevel: { measured: ({ sessions }) => sessions > 0 },

  // Repo-level only: nothing per ticket to drop.
  anonymize: (value) => value,

  figure: ORCHESTRATION_FIGURE,

  // Repo level, so nothing per ticket to draw: its hours by month. A month with
  // no orchestration activity is unknown, drawn as a gap, never as 0 h.
  chart: {
    title: "Orchestration time by month",
    draw: (input) => trendLine(input, ORCHESTRATION_FIGURE, "Orchestration time"),
  },

  sentence: ({ hours, sessions }) =>
    `${formatHours(hours)} of active orchestration (planning, grilling, batching) in ${plural(sessions, "session")} on no ticket`,

  section({ hours, sessions, subAgents, humanMessages }) {
    return `<p><strong>${formatHours(hours)}</strong> in ${plural(sessions, "session")} on no ticket, with ${plural(humanMessages, "human message")} and ${plural(subAgents, "sub-agent")}.</p>`;
  },

  methodology: {
    definition: `Active time of the Claude Code sessions linked to no ticket: those on the default branch, or any branch naming no issue, that opened no ticket's PR (grilling, planning, orchestrating sub-agents, landing batches). Active time adds the gaps between a session's consecutive transcript lines, each capped at ${String(IDLE_CAP_MS / 60_000)} minutes, so a session left open overnight counts only while in use. Sub-agents' time is not added (they run in parallel); they are counted. Sessions on a branch naming work that is not delivered count neither here nor on a ticket. A session with no cached transcript counts through its session records: what its merge commits, and its commits of no ticket, added to its counters.`,
    limits:
      "Only sessions whose transcripts were cached locally count; coverage gives the tickets that have transcripts, as a measure of how complete they are, not tickets the time is computed over: it is repo-level, so it is shown even when no ticket has transcripts. It is unknown, not 0 h, when no session linked to no ticket has measured activity: transcripts were read, but none was of orchestration, so whether any took place is not known. A ticket worked on from a session on the default branch, without a ticket branch or PR of its own, counts here. Time spent reading or thinking without the session writing anything for over the cap is not counted.",
  },
};
