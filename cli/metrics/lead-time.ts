import { trendLine } from "../report/charts.ts";
import type { Figure, Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { formatHours, hoursBetween, percentile, plural, round } from "./stats.ts";

export interface LeadTime {
  p50Hours: number;
  p90Hours: number;
  /** Each ticket's lead time, in delivery order, so the percentiles can be traced. Absent once anonymized. */
  tickets?: { ticket: string; hours: number }[];
}

export const leadTime: Metric<LeadTime> = {
  id: "leadTime",
  name: "Lead time",

  compute({ tickets }) {
    const rows = tickets.flatMap((ticket) =>
      ticket.readyAt ? [{ ticket: ticket.id, hours: hoursBetween(ticket.readyAt, ticket.doneAt) }] : [],
    );
    const coverage = { tickets: rows.length, of: tickets.length };
    if (rows.length === 0) return { value: UNKNOWN, coverage };
    const hours = rows.map((row) => row.hours);
    return {
      value: {
        p50Hours: round(percentile(hours, 50), 1),
        p90Hours: round(percentile(hours, 90), 1),
        tickets: rows.map((row) => ({ ...row, hours: round(row.hours, 1) })),
      },
      coverage,
    };
  },

  // Per-ticket rows name tickets: an anonymized dataset keeps the percentiles only.
  anonymize: ({ p50Hours, p90Hours }) => ({ p50Hours, p90Hours }),

  figure: { label: "p50", of: ({ p50Hours }) => p50Hours, format: formatHours },

  sentence: ({ p50Hours, p90Hours }) =>
    `Median lead time of ${formatHours(p50Hours)} from a ticket being ready to its last PR merging (p90 ${formatHours(p90Hours)})`,

  // Each ticket's lead time; an anonymized dataset has none, so its p50 by month instead.
  chart: {
    title: "Lead time per ticket",
    draw(input) {
      const { p50Hours, p90Hours, tickets } = input.value;
      if (!tickets?.length) return trendLine(input, leadTime.figure as Figure<unknown>, "Lead time");
      const hours = tickets.map((t) => t.hours);
      return {
        kind: "distribution",
        data: tickets.map((t) => ({ label: t.ticket, value: t.hours })),
        markers: [
          { label: "p50", value: p50Hours },
          { label: "p90", value: p90Hours },
        ],
        format: formatHours,
        heads: ["Ticket", "Lead time"],
        description: `Lead time of each of ${plural(tickets.length, "ticket")}, from ${formatHours(Math.min(...hours))} to ${formatHours(Math.max(...hours))}: p50 ${formatHours(p50Hours)}, p90 ${formatHours(p90Hours)}.`,
      };
    },
  },

  headline: {
    order: 1,
    card: ({ p50Hours, p90Hours }) => `${formatHours(p50Hours)} <small>p50</small> · ${formatHours(p90Hours)} <small>p90</small>`,
  },

  section: ({ p50Hours, p90Hours }) =>
    `<p>Half the tickets took up to <strong>${formatHours(p50Hours)}</strong> from ready to merged, and nine in ten up to <strong>${formatHours(p90Hours)}</strong>.</p>`,

  ticketTable: {
    columns: ["Lead time"],
    rows: ({ tickets }) => tickets?.map((t) => ({ id: t.ticket, cells: [{ text: formatHours(t.hours), sort: t.hours }] })),
  },

  methodology: {
    definition:
      "Time from a ticket becoming ready to its last PR merging into the default branch, as the median (p50) and the 90th percentile (p90, nearest rank). A ticket becomes ready when the repo's ready label is first added; a ticket never labelled ready before it was done starts at its creation. A PR linked to no issue has no ready moment: it starts at the earlier of its opening and its first commit (authored date), since a PR can be opened only to merge it. Integration PRs and excluded PRs are not tickets.",
    limits:
      "An issue closed with no merged PR (work pushed straight to the default branch, or closed as done by hand) is not a delivered ticket and is not counted. Tickets whose issue GitHub did not return have no start and are left out. So is a PR linked to no issue that was opened after its only commit: a lone commit is written once the work is done, so GitHub shows nothing from before the work ended, and its lead time is unknown rather than the minutes between that commit and the merge. For a PR with several commits, the first commit is a late bound on when the work began. Time waiting in a batch or integration branch counts, since the ticket is not delivered until its PR reaches the default branch: a PR merged into an integration branch is done when that branch's integration PR merges.",
  },
};
