import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { sessionSources } from "../records.ts";
import { ticketFriction } from "./friction.ts";
import { percentile, plural, round, sum } from "./stats.ts";

export interface HumanMessages {
  p50: number;
  p90: number;
  mean: number;
  /** Human messages in the sessions linked to no ticket: steering that no per-ticket figure shows. Absent from older datasets. */
  orchestration?: number;
  /** How many of its tickets were read from transcripts, and how many from session records. Absent from older datasets. */
  sources?: { transcripts: number; records: number };
  /** Interrupts (a person stopping a turn), over the tickets whose every session has a transcript. Absent from older datasets, and when none has. */
  interrupts?: { p50: number; total: number; tickets: number };
  /** The tickets with transcripts or session records, in delivery order; `interrupts` when known. Absent once anonymized. */
  perTicket?: { ticket: string; messages: number; interrupts?: number }[];
}

export const humanMessagesPerTicket: Metric<HumanMessages> = {
  id: "humanMessagesPerTicket",
  name: "Human messages per ticket",

  compute({ tickets, transcripts }) {
    const perTicket = tickets.flatMap((ticket) => {
      if (ticket.sessions.length === 0) return [];
      const messages = new Set(ticket.sessions.flatMap((session) => session.humanMessages));
      const found = ticketFriction(ticket);
      return [{ ticket: ticket.id, messages: messages.size, ...(found && { interrupts: found.interrupts.length }) }];
    });
    const interruptCounts = perTicket.flatMap((row) => (row.interrupts === undefined ? [] : [row.interrupts]));
    const coverage = { tickets: perTicket.length, of: tickets.length };
    if (perTicket.length === 0) return { value: UNKNOWN, coverage };
    const counts = perTicket.map((row) => row.messages);
    const mean = Math.round((counts.reduce((sum, count) => sum + count, 0) / counts.length) * 10) / 10;
    const orchestration = new Set(transcripts.orchestration.filter((session) => session.agentId === undefined).flatMap((session) => session.humanMessages)).size;
    const interrupts = interruptCounts.length ? { p50: percentile(interruptCounts, 50), total: sum(interruptCounts), tickets: interruptCounts.length } : undefined;
    return { value: { p50: percentile(counts, 50), p90: percentile(counts, 90), mean, orchestration, sources: sessionSources(tickets), ...(interrupts && { interrupts }), perTicket }, coverage };
  },

  anonymize: ({ p50, p90, mean, orchestration, sources, interrupts }) => ({
    p50,
    p90,
    mean,
    ...(orchestration !== undefined && { orchestration }),
    ...(sources && { sources }),
    ...(interrupts && { interrupts }),
  }),

  figure: { label: "p50", of: ({ p50 }) => p50, format: String },

  sentence: ({ p50, p90 }) => `A median of ${String(p50)} human messages per ticket (p90 ${String(p90)})`,

  headline: {
    order: 3,
    card: ({ p50, p90 }) => `${String(p50)} <small>p50</small> · ${String(p90)} <small>p90</small>`,
    // Over every repo's tickets with transcripts: an anonymized repo, with no rows, never pools.
    pool(known) {
      const counts = known.flatMap(({ value }) => (value.perTicket ?? []).map((row) => row.messages));
      if (counts.length === 0) return undefined;
      return { p50: percentile(counts, 50), p90: percentile(counts, 90), mean: round(sum(counts) / counts.length, 1) };
    },
  },

  section({ mean, orchestration, sources, interrupts }) {
    const perTicket = `<p>Mean <strong>${String(mean)}</strong> human messages per ticket with transcripts or session records.</p>`;
    const beside =
      orchestration === undefined
        ? ""
        : `<p><strong>${plural(orchestration, "human message")}</strong> more went to orchestration: sessions on no ticket, which plan the work and steer the agents that do it. A ticket done by a sub-agent shows none of them.</p>`;
    const from = sources ? `<p>Read from transcripts: ${plural(sources.transcripts, "ticket")}; from session records: ${plural(sources.records, "ticket")}.</p>` : "";
    const stopped = interrupts
      ? `<p>Besides messages, a person interrupted a turn <strong>${plural(interrupts.total, "time")}</strong> (median ${String(interrupts.p50)} per ticket, over ${plural(interrupts.tickets, "ticket")} with transcripts). An interrupt is not a human message.</p>`
      : "";
    return perTicket + stopped + beside + from;
  },

  ticketTable: {
    columns: ["Human messages", "Interrupts"],
    rows: ({ perTicket }) =>
      perTicket?.map((row) => ({
        id: row.ticket,
        cells: [
          { text: String(row.messages), sort: row.messages },
          row.interrupts === undefined ? { text: "unknown", sort: -1 } : { text: String(row.interrupts), sort: row.interrupts },
        ],
      })),
  },

  methodology: {
    definition:
      "Messages a person typed in the Claude Code sessions of a ticket, as the median (p50) and 90th percentile (p90, nearest rank) over the tickets that have transcripts. A session belongs to a ticket through the branch it ran on (a ticket PR's head branch, or the issue number the branch regex finds), else the worktree it ran in, else the PRs it opened or touched; a sub-agent with none of these belongs to the ticket of the session that spawned it. Slash commands, shell escapes (<code>!</code>), tool results and approvals, interrupts, sub-agent notifications, messages between agents and text Claude Code injects are not human messages. A message written twice (a resumed session) counts once. A session whose transcript is not cached is read from its session records instead, the counts it left as a <code>Session-Record:</code> trailer on its commits: each commit adds what its session's counters gained since that session's previous commit, to the ticket the commit belongs to; what a merge adds, or a commit of no ticket, is orchestration. The messages of sessions linked to no ticket are given beside the figure, as orchestration.",
    limits:
      "Only sessions with a cached transcript or session records are counted: a session on another device or in the cloud with no recorder installed, and work outside Claude Code, show as unknown and are left out, not counted as zero. A session record counts the prompts the recorder saw, which can differ slightly from a transcript's count, and holds nothing of what a session did after its last commit. A session that ran on the default branch and opened no PR of the ticket counts as orchestration, not as the ticket's, so a ticket steered from an orchestrating session shows fewer messages than the person wrote about it. A session linked to a PR that delivers several tickets counts for each.",
  },
};
