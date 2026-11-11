// Skill usage: the skills each ticket's sessions used, typed by a person as a
// slash command or invoked by Claude with the Skill tool, from transcripts.
// The comparison of every metric between tickets that used a skill and those
// that didn't is the dataset's `bySkill` (`trends.ts`); an anonymized dataset
// keeps the number of skills per ticket only, never a name.
import type { Ticket } from "../linker.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { escapeHtml } from "./html.ts";
import { percentile, plural, round, sum } from "./stats.ts";

export interface SkillRow {
  name: string;
  /** Tickets that used it. */
  tickets: number;
  /** Times a person typed it, and times Claude invoked it. */
  typed: number;
  invoked: number;
}

export interface Skills {
  /** Distinct skills per ticket. */
  p50: number;
  mean: number;
  /** By skill, most used first. Absent once anonymized. */
  skills?: SkillRow[];
  /** Per ticket, the skills it used. Absent once anonymized. */
  perTicket?: { ticket: string; skills: string[] }[];
}

/** The skills a ticket's sessions used, when every one of them has a transcript; undefined otherwise. */
export function ticketSkills(ticket: Ticket): { name: string; typed: boolean; id: string }[] | undefined {
  if (ticket.sessions.length === 0 || ticket.sessions.some((session) => session.skills === undefined)) return undefined;
  const uses = new Map(ticket.sessions.flatMap((session) => session.skills ?? []).map((use) => [use.id, use]));
  return [...uses.values()];
}

export const skills: Metric<Skills> = {
  id: "skills",
  name: "Skill usage",

  compute({ tickets }) {
    const measured = tickets.flatMap((ticket) => {
      const uses = ticketSkills(ticket);
      return uses ? [{ ticket, uses }] : [];
    });
    const coverage = { tickets: measured.length, of: tickets.length };
    if (measured.length === 0) return { value: UNKNOWN, coverage };
    const perTicket = measured.map(({ ticket, uses }) => ({ ticket: ticket.id, skills: [...new Set(uses.map((use) => use.name))].sort() }));
    const counts = perTicket.map((row) => row.skills.length);
    const rows = new Map<string, SkillRow>();
    for (const { uses } of measured) {
      for (const use of uses) {
        const row = rows.get(use.name) ?? { name: use.name, tickets: 0, typed: 0, invoked: 0 };
        if (use.typed) row.typed++;
        else row.invoked++;
        rows.set(use.name, row);
      }
      for (const name of new Set(uses.map((use) => use.name))) {
        const row = rows.get(name);
        if (row) row.tickets++;
      }
    }
    return {
      value: {
        p50: percentile(counts, 50),
        mean: round(sum(counts) / counts.length, 1),
        skills: [...rows.values()].sort((a, b) => b.tickets - a.tickets || a.name.localeCompare(b.name)),
        perTicket,
      },
      coverage,
    };
  },

  anonymize: ({ p50, mean }) => ({ p50, mean }),

  figure: { label: "p50", of: ({ p50 }) => p50, format: String },

  chart: {
    title: "Tickets per skill",
    draw: ({ value: { skills: rows, p50 } }) => ({
      kind: "comparison",
      // No skill used, or names withheld: the median per ticket alone.
      data: rows?.length ? rows.slice(0, 12).map((row) => ({ label: row.name, value: row.tickets })) : [{ label: "Skills per ticket, p50", value: p50 }],
      format: String,
      heads: ["Skill", "Tickets"],
      description: rows?.length ? `The skills most tickets used, of ${plural(rows.length, "skill")} in all.` : `A median of ${String(p50)} skills per ticket.`,
    }),
  },

  section({ p50, mean, skills: rows }) {
    const per = `<p>A median of <strong>${String(p50)}</strong> skills per ticket with transcripts (mean ${String(mean)}).</p>`;
    if (!rows?.length) return per;
    const table = rows
      .map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${String(row.tickets)}</td><td>${String(row.typed)}</td><td>${String(row.invoked)}</td></tr>`)
      .join("\n");
    return `${per}<div class="scroll"><table><thead><tr><th>Skill</th><th>Tickets</th><th>Typed</th><th>Invoked by Claude</th></tr></thead><tbody>\n${table}\n</tbody></table></div>
<p>Each metric's page compares the tickets that used a skill with those that didn't, for skills used on 5 tickets or more.</p>`;
  },

  ticketTable: {
    columns: ["Skills"],
    rows: ({ perTicket }) => perTicket?.map((row) => ({ id: row.ticket, cells: [row.skills.join(", ") || "none"] })),
  },

  sentence: ({ p50 }) => (p50 > 0 ? `A median of ${String(p50)} skills used per ticket` : undefined),

  methodology: {
    definition:
      "The skills a ticket's Claude Code sessions used (sub-agents included, linked as for human messages), from their transcripts: a skill a person typed as a slash command (a command whose next line loads a skill, so built-in commands are not skills), or one Claude invoked with the Skill tool. Each use is counted once. The figure is the median number of distinct skills per ticket. On each metric's page, its figure is compared between the tickets that used a skill and the tickets with transcripts that didn't, for each skill used on 5 tickets or more.",
    limits:
      "Only tickets whose every session has a transcript are measured: session records name no skill. A comparison shows tickets that used a skill alongside those that didn't; it does not show that the skill caused the difference. An anonymized dataset keeps the number of skills per ticket only, and no comparison by skill, since skill names can say what a private repo is about.",
  },
};
