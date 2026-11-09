import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { percentile } from "./stats.ts";

export interface HumanMessages {
  p50: number;
  p90: number;
  mean: number;
  /** The tickets with transcripts, in delivery order. Absent once anonymized. */
  perTicket?: { ticket: string; messages: number }[];
}

export const humanMessagesPerTicket: Metric<HumanMessages> = {
  id: "humanMessagesPerTicket",
  name: "Human messages per ticket",

  compute({ tickets }) {
    const perTicket = tickets.flatMap((ticket) => {
      if (ticket.sessions.length === 0) return [];
      const messages = new Set(ticket.sessions.flatMap((session) => session.humanMessages));
      return [{ ticket: ticket.id, messages: messages.size }];
    });
    const coverage = { tickets: perTicket.length, of: tickets.length };
    if (perTicket.length === 0) return { value: UNKNOWN, coverage };
    const counts = perTicket.map((row) => row.messages);
    const mean = Math.round((counts.reduce((sum, count) => sum + count, 0) / counts.length) * 10) / 10;
    return { value: { p50: percentile(counts, 50), p90: percentile(counts, 90), mean, perTicket }, coverage };
  },

  anonymize: ({ p50, p90, mean }) => ({ p50, p90, mean }),

  figure: { label: "p50", of: ({ p50 }) => p50, format: String },

  sentence: ({ p50, p90 }) => `A median of ${String(p50)} human messages per ticket (p90 ${String(p90)})`,

  headline({ p50, p90 }) {
    return `${String(p50)} <small>p50</small> · ${String(p90)} <small>p90</small>`;
  },

  section({ perTicket, mean }) {
    if (!perTicket) return `<p>Mean ${String(mean)} per ticket with transcripts.</p>`;
    const rows = perTicket.map((row) => `<tr><td>${row.ticket}</td><td>${String(row.messages)}</td></tr>`).join("");
    return `<p>Mean ${String(mean)}.</p><table><thead><tr><th>Ticket</th><th>Human messages</th></tr></thead><tbody>${rows}</tbody></table>`;
  },

  methodology: {
    definition:
      "Messages a person typed in the Claude Code sessions of a ticket, as the median (p50) and 90th percentile (p90, nearest rank) over the tickets that have transcripts. A session belongs to a ticket through the branch it ran on (a ticket PR's head branch, or the issue number the branch regex finds), else the worktree it ran in, else the PRs it opened or touched; a sub-agent with none of these belongs to the ticket of the session that spawned it. Slash commands, shell escapes (<code>!</code>), tool results and approvals, interrupts, sub-agent notifications, messages between agents and text Claude Code injects are not human messages. A message written twice (a resumed session) counts once.",
    limits:
      "Only work done in local Claude Code sessions whose transcripts were cached has transcripts: cloud sessions and work outside Claude Code show as unknown and are left out, not counted as zero. A session that ran on the default branch and opened no PR of the ticket counts as orchestration, not as the ticket's, so a ticket steered from an orchestrating session shows fewer messages than the person wrote about it. A session linked to a PR that delivers several tickets counts for each.",
  },
};
