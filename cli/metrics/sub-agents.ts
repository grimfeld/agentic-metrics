import type { Ticket } from "../linker.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { escapeHtml } from "./html.ts";
import { percentile } from "./stats.ts";

export interface ModelCount {
  /** A model id, or `unknown` for a sub-agent whose model was never written. */
  model: string;
  subAgents: number;
}

export interface SubAgents {
  /** Distinct sub-agents over the tickets with transcripts; one working on several tickets counts once. */
  total: number;
  p50: number;
  p90: number;
  /** The models they ran on, most used first. */
  models: ModelCount[];
  /** The tickets with transcripts, in delivery order. Absent once anonymized. */
  perTicket?: { ticket: string; subAgents: number; models: ModelCount[] }[];
}

/** The sub-agents of a ticket, by agent id, with the model each ran on. */
function subAgentsOf(ticket: Ticket): Map<string, string> {
  const agents = new Map<string, string>();
  // A sub-agent's own transcript says what it ran on: the model of most of its responses.
  for (const session of ticket.sessions) {
    if (session.agentId === undefined) continue;
    const counts = new Map<string, number>();
    for (const response of session.responses) counts.set(response.model, (counts.get(response.model) ?? 0) + 1);
    const model = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    agents.set(session.agentId, model ?? UNKNOWN);
  }
  // A spawn whose transcript is missing (or linked elsewhere): the model Claude Code resolved.
  for (const session of ticket.sessions) {
    for (const spawn of session.spawns) {
      if (!agents.has(spawn.agentId) || agents.get(spawn.agentId) === UNKNOWN) agents.set(spawn.agentId, spawn.model ?? UNKNOWN);
    }
  }
  return agents;
}

function modelMix(agents: Iterable<string>): ModelCount[] {
  const counts = new Map<string, number>();
  for (const model of agents) counts.set(model, (counts.get(model) ?? 0) + 1);
  return [...counts].map(([model, subAgents]) => ({ model, subAgents })).sort((a, b) => b.subAgents - a.subAgents || a.model.localeCompare(b.model));
}

export const subAgents: Metric<SubAgents> = {
  id: "subAgents",
  name: "Sub-agents per ticket",

  compute({ tickets }) {
    const withTranscripts = tickets.filter((ticket) => ticket.sessions.length > 0);
    const coverage = { tickets: withTranscripts.length, of: tickets.length };
    if (withTranscripts.length === 0) return { value: UNKNOWN, coverage };
    const all = new Map<string, string>();
    const perTicket = withTranscripts.map((ticket) => {
      const agents = subAgentsOf(ticket);
      for (const [id, model] of agents) all.set(id, model);
      return { ticket: ticket.id, subAgents: agents.size, models: modelMix(agents.values()) };
    });
    const counts = perTicket.map((row) => row.subAgents);
    return {
      value: { total: all.size, p50: percentile(counts, 50), p90: percentile(counts, 90), models: modelMix(all.values()), perTicket },
      coverage,
    };
  },

  anonymize: ({ total, p50, p90, models }) => ({ total, p50, p90, models }),

  section({ total, p50, p90, models, perTicket }) {
    const mix = (rows: ModelCount[]) => rows.map((row) => `${escapeHtml(row.model)} ${String(row.subAgents)}`).join(", ") || "none";
    const summary = `<p>${String(total)} sub-agent${total === 1 ? "" : "s"} on the tickets with transcripts (p50 ${String(p50)}, p90 ${String(p90)} per ticket). Models: ${mix(models)}.</p>`;
    if (!perTicket) return summary;
    const rows = perTicket.map((row) => `<tr><td>${row.ticket}</td><td>${String(row.subAgents)}</td><td>${mix(row.models)}</td></tr>`).join("");
    return `${summary}<table><thead><tr><th>Ticket</th><th>Sub-agents</th><th>Models</th></tr></thead><tbody>${rows}</tbody></table>`;
  },

  methodology: {
    definition:
      "Sub-agents that worked on a ticket: those whose own transcript is linked to the ticket (as for human messages: their branch or worktree, else the ticket of the session that spawned them), and those spawned with the Agent tool from one of the ticket's sessions. Each runs on the model of most of its API responses, or, without a transcript, the model Claude Code resolved when spawning it. The total counts a sub-agent once even when it worked on several tickets; p50 and p90 (nearest rank) are over the tickets that have transcripts, including those with no sub-agent.",
    limits:
      "Only tickets with cached local transcripts are measured; others are left out, not counted as zero. Sub-agents spawned from a session linked to no ticket count only on the ticket their own branch names. A sub-agent that switched models counts under the one it used most.",
  },
};
