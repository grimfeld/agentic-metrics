// Friction: where a ticket's sessions struggled. Tool calls that failed, tool
// calls refused (by the person or the permission mode), and context
// compactions, per ticket, from transcripts. A session read from records holds
// none of it, so a ticket known only through records is left out, not counted
// as frictionless.
import type { Ticket } from "../linker.ts";
import type { Friction as SessionFriction } from "../transcripts/load.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { percentile, plural, round, sum } from "./stats.ts";

export interface FrictionRow {
  ticket: string;
  toolErrors: number;
  denials: number;
  compactions: number;
}

export interface Friction {
  /** Medians (nearest rank) per ticket. */
  p50: { toolErrors: number; denials: number; compactions: number };
  /** Totals over the tickets measured. */
  totals: { toolErrors: number; denials: number; compactions: number };
  /** Per ticket, in delivery order. Absent once anonymized. */
  perTicket?: FrictionRow[];
}

/** A ticket's friction, each event once; undefined when one of its sessions has no transcript. */
export function ticketFriction(ticket: Ticket): SessionFriction | undefined {
  if (ticket.sessions.length === 0 || ticket.sessions.some((session) => session.friction === undefined)) return undefined;
  const all = (key: keyof SessionFriction) => [...new Set(ticket.sessions.flatMap((session) => session.friction?.[key] ?? []))];
  return { interrupts: all("interrupts"), toolErrors: all("toolErrors"), denials: all("denials"), compactions: all("compactions") };
}

export const friction: Metric<Friction> = {
  id: "friction",
  name: "Friction",

  compute({ tickets }) {
    const perTicket = tickets.flatMap((ticket): FrictionRow[] => {
      const found = ticketFriction(ticket);
      return found ? [{ ticket: ticket.id, toolErrors: found.toolErrors.length, denials: found.denials.length, compactions: found.compactions.length }] : [];
    });
    const coverage = { tickets: perTicket.length, of: tickets.length };
    if (perTicket.length === 0) return { value: UNKNOWN, coverage };
    const column = (key: "toolErrors" | "denials" | "compactions") => perTicket.map((row) => row[key]);
    return {
      value: {
        p50: { toolErrors: percentile(column("toolErrors"), 50), denials: percentile(column("denials"), 50), compactions: percentile(column("compactions"), 50) },
        totals: { toolErrors: sum(column("toolErrors")), denials: sum(column("denials")), compactions: sum(column("compactions")) },
        perTicket,
      },
      coverage,
    };
  },

  anonymize: ({ p50, totals }) => ({ p50, totals }),

  figure: { label: "tool errors p50", of: ({ p50 }) => p50.toolErrors, format: String },

  chart: {
    title: "Friction, in all",
    draw: ({ value: { totals } }) => ({
      kind: "comparison",
      data: [
        { label: "Tool errors", value: totals.toolErrors },
        { label: "Refused", value: totals.denials },
        { label: "Compactions", value: totals.compactions },
      ],
      format: String,
      heads: ["Friction", "Count"],
      description: `Over the tickets with transcripts: ${plural(totals.toolErrors, "failed tool call")}, ${plural(totals.denials, "refused tool call")}, ${plural(totals.compactions, "compaction")}.`,
    }),
  },

  section({ p50, totals }) {
    return `<p>Per ticket, a median of <strong>${String(p50.toolErrors)}</strong> failed tool calls, <strong>${String(p50.denials)}</strong> refused and <strong>${String(p50.compactions)}</strong> compactions.</p>
<p>In all: ${plural(totals.toolErrors, "failed tool call")}, ${plural(totals.denials, "refused tool call")}, ${plural(totals.compactions, "compaction")}.</p>`;
  },

  ticketTable: {
    columns: ["Tool errors", "Refused", "Compactions"],
    rows: ({ perTicket }) =>
      perTicket?.map((row) => ({
        id: row.ticket,
        cells: [
          { text: String(row.toolErrors), sort: row.toolErrors },
          { text: String(row.denials), sort: row.denials },
          { text: String(row.compactions), sort: row.compactions },
        ],
      })),
  },

  sentence: ({ p50, totals }) =>
    totals.toolErrors + totals.denials + totals.compactions === 0
      ? undefined
      : `A median of ${String(round(p50.toolErrors, 1))} failed tool calls and ${String(p50.compactions)} context compactions per ticket`,

  methodology: {
    definition:
      "Three counts per ticket, from the transcripts of its Claude Code sessions (sub-agents included, linked as for human messages): <strong>tool errors</strong>, tool calls whose result is an error; <strong>refused</strong>, tool calls the person refused, or the permission mode denied (their result says so), counted apart from errors; <strong>compactions</strong>, the times a session's context was compacted. Each is counted once, also when a resumed session repeats it. The figures are medians (nearest rank) per ticket, and totals.",
    limits:
      "Only tickets whose every session has a transcript are measured: session records hold no friction, so a ticket known only through records is left out, not counted as frictionless. A tool error is not always a problem (a test run that fails on purpose is one). A refusal by the permission mode is told from one by the person only by its wording, which can change between Claude Code versions.",
  },
};
