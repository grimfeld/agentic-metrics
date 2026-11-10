import { phasesOf, type Phases } from "../activity.ts";
import { perTicketChart, spanText, type Chart } from "../report/charts.ts";
import type { Figure, Metric, TableCell } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { formatHours, formatPercent, hoursBetween, percent, percentile, plural, round, sum } from "./stats.ts";

/** One phase of lead time over the tickets whose phases are known. */
export interface PhaseSummary {
  p50Hours: number;
  /** Its part of those tickets' total lead time, from 0 to 1. */
  share: number;
}

export interface LeadTime {
  p50Hours: number;
  p90Hours: number;
  /**
   * Lead time split into queue, work and landing wait, over the tickets with a
   * lead time and dated activity. Absent when there is none, and from a
   * dataset written before the split.
   */
  phases?: { tickets: number; queue: PhaseSummary; work: PhaseSummary; landing: PhaseSummary };
  /**
   * Each ticket's lead time, in delivery order, so the percentiles can be
   * traced; its three phases add up to it, and are absent when it has no dated
   * activity. Absent once anonymized.
   */
  tickets?: ({ ticket: string; hours: number } & Partial<Phases>)[];
}

const PHASES = [
  { key: "queue", hours: "queueHours", name: "Queue" },
  { key: "work", hours: "workHours", name: "Work" },
  { key: "landing", hours: "landingHours", name: "Landing wait" },
] as const;

function summarise(split: readonly Phases[]): LeadTime["phases"] {
  if (split.length === 0) return undefined;
  const total = sum(split.flatMap((phases) => [phases.queueHours, phases.workHours, phases.landingHours]));
  const one = (hours: (typeof PHASES)[number]["hours"]): PhaseSummary => {
    const values = split.map((phases) => phases[hours]);
    return { p50Hours: round(percentile(values, 50), 1), share: total > 0 ? round(sum(values) / total, 3) : 0 };
  };
  return { tickets: split.length, queue: one("queueHours"), work: one("workHours"), landing: one("landingHours") };
}

/** `Queue 2% (p50 0 h), Work 61% (p50 0.2 h), Landing wait 37% (p50 0.5 h)`. Plain text. */
function phasesText(phases: NonNullable<LeadTime["phases"]>): string {
  return PHASES.map(({ key, name }) => `${name} ${formatPercent(percent(phases[key].share))} (p50 ${formatHours(phases[key].p50Hours)})`).join(", ");
}

/** Each phase's share of the total lead time, as comparison bars. */
function phasesChart(phases: NonNullable<LeadTime["phases"]>): Chart {
  return {
    kind: "comparison",
    data: PHASES.map(({ key, name }, index) => ({
      label: name,
      value: percent(phases[key].share),
      note: `p50 ${formatHours(phases[key].p50Hours)}`,
      series: (index + 1) as 1 | 2 | 3,
    })),
    format: formatPercent,
    heads: ["Phase", "Share of lead time", "Per ticket"],
    description: `Where the lead time of ${plural(phases.tickets, "ticket")} went, as the share of their total that each phase took: ${phasesText(phases)}.`,
  };
}

const hoursCell = (hours: number | undefined): TableCell => (hours === undefined ? UNKNOWN : { text: formatHours(hours), sort: hours });

const LEAD_TIME_FIGURE: Figure<LeadTime> = { label: "p50", of: ({ p50Hours }) => p50Hours, format: formatHours };

export const leadTime: Metric<LeadTime> = {
  id: "leadTime",
  name: "Lead time",

  compute({ tickets }) {
    const split: Phases[] = [];
    const rows = tickets.flatMap((ticket) => {
      if (!ticket.readyAt) return [];
      const phases = phasesOf(ticket);
      if (phases) split.push(phases);
      const rounded = phases && { queueHours: round(phases.queueHours, 1), workHours: round(phases.workHours, 1), landingHours: round(phases.landingHours, 1) };
      return [{ ticket: ticket.id, hours: hoursBetween(ticket.readyAt, ticket.doneAt), ...rounded }];
    });
    const phases = summarise(split);
    const coverage = { tickets: rows.length, of: tickets.length };
    if (rows.length === 0) return { value: UNKNOWN, coverage };
    const hours = rows.map((row) => row.hours);
    return {
      value: {
        p50Hours: round(percentile(hours, 50), 1),
        p90Hours: round(percentile(hours, 90), 1),
        ...(phases && { phases }),
        tickets: rows.map((row) => ({ ...row, hours: round(row.hours, 1) })),
      },
      coverage,
    };
  },

  // Per-ticket rows name tickets: an anonymized dataset keeps the percentiles and the phases' aggregates only.
  anonymize: ({ p50Hours, p90Hours, phases }) => ({ p50Hours, p90Hours, ...(phases && { phases }) }),

  figure: LEAD_TIME_FIGURE,

  sentence: ({ p50Hours, p90Hours }) =>
    `Median lead time of ${formatHours(p50Hours)} from a ticket being ready to its last PR merging (p90 ${formatHours(p90Hours)})`,

  // Its breakdown: where the lead time went, by phase. Without phases (no dated activity, or a dataset written
  // before the split): each ticket's lead time, or, anonymized, its p50 by month.
  chart: {
    title: "Lead time breakdown",
    draw(input) {
      const { p50Hours, p90Hours, tickets, phases } = input.value;
      if (phases) return phasesChart(phases);
      return perTicketChart(input, LEAD_TIME_FIGURE, {
        what: "Lead time",
        rows: tickets?.map((t) => ({ ticket: t.ticket, value: t.hours })),
        head: "Lead time",
        markers: [
          { label: "p50", value: p50Hours },
          { label: "p90", value: p90Hours },
        ],
        format: formatHours,
        description: (rows) =>
          `Lead time of each of ${plural(rows.length, "ticket")}, ${spanText(rows, formatHours)}: p50 ${formatHours(p50Hours)}, p90 ${formatHours(p90Hours)}.`,
      });
    },
  },

  section({ p50Hours, p90Hours, phases }) {
    const whole = `<p>Half the tickets took up to <strong>${formatHours(p50Hours)}</strong> from ready to delivered, and nine in ten up to <strong>${formatHours(p90Hours)}</strong>.</p>`;
    if (!phases) return whole;
    return `${whole}<p>Over the ${plural(phases.tickets, "ticket")} with dated activity, that time went to: ${phasesText(phases)}. Queue and landing wait are idle; work can hold idle too (see active time).</p>`;
  },

  ticketTable: {
    columns: ["Lead time", "Queue", "Work", "Landing wait"],
    rows: ({ tickets }) =>
      tickets?.map((t) => ({
        id: t.ticket,
        cells: [{ text: formatHours(t.hours), sort: t.hours }, hoursCell(t.queueHours), hoursCell(t.workHours), hoursCell(t.landingHours)],
      })),
  },

  methodology: {
    definition:
      "Time from a ticket becoming ready to its last PR merging into the default branch, as the median (p50) and the 90th percentile (p90, nearest rank). A ticket becomes ready when the repo's ready label is first added; a ticket never labelled ready before it was done starts at its creation. A PR linked to no issue has no ready moment: it starts at the earlier of its opening and its first commit (authored date), since a PR can be opened only to merge it. Integration PRs and excluded PRs are not tickets. Lead time is split into three phases that add up to it: <strong>queue</strong>, from ready to the ticket's first activity; <strong>work</strong>, from its first activity to its last; <strong>landing wait</strong>, from its last activity to delivery. Activity is the authored date of each of the ticket's own commits (merges left out: a merge lands work) and every line of its Claude Code sessions, sub-agents included. Each phase is given as its median per ticket and as its share of the total lead time, over the tickets with dated activity. A batched ticket's work ends at its own last activity, so the wait for its batch to land is landing wait.",
    limits:
      "An issue closed with no merged PR (work pushed straight to the default branch, or closed as done by hand) is not a delivered ticket and is not counted. Tickets whose issue GitHub did not return have no start and are left out. So is a PR linked to no issue that was opened after its only commit: a lone commit is written once the work is done, so GitHub shows nothing from before the work ended, and its lead time is unknown rather than the minutes between that commit and the merge. For a PR with several commits, the first commit is a late bound on when the work began. Time waiting in a batch or integration branch counts, since the ticket is not delivered until its PR reaches the default branch: a PR merged into an integration branch is done when that branch's integration PR merges. Phases are read within the lead time: work that began before the ticket was ready gives a queue of 0, and activity after delivery is ignored. A ticket whose only trace is one commit has no work phase to speak of: its lead time is queue and landing wait. Without cached transcripts, activity is commits alone, so time spent before the first commit counts as queue and time after the last as landing wait. The work phase is elapsed time and can hold idle: a branch left for two weeks between two commits is two weeks of work phase.",
  },
};
