import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { formatHours, percentile } from "./stats.ts";

export interface LeadTime {
  p50Hours: number;
  p90Hours: number;
}

export const leadTime: Metric<LeadTime> = {
  id: "leadTime",
  name: "Lead time",

  compute({ tickets }) {
    const hours = tickets.flatMap((ticket) =>
      ticket.readyAt ? [(ticket.doneAt.getTime() - ticket.readyAt.getTime()) / 3_600_000] : [],
    );
    const coverage = { tickets: hours.length, of: tickets.length };
    if (hours.length === 0) return { value: UNKNOWN, coverage };
    const round = (value: number) => Math.round(value * 10) / 10;
    return { value: { p50Hours: round(percentile(hours, 50)), p90Hours: round(percentile(hours, 90)) }, coverage };
  },

  anonymize: (value) => value,

  headline({ p50Hours, p90Hours }) {
    return `${formatHours(p50Hours)} <small>p50</small> · ${formatHours(p90Hours)} <small>p90</small>`;
  },

  methodology: {
    definition:
      "Time from a ticket becoming ready to its last PR merging into the default branch, as the median (p50) and the 90th percentile (p90, nearest rank). A ticket becomes ready when the repo's ready label is first added; a ticket never labelled ready before it was done starts at its creation. A PR linked to no issue starts when it was opened. Integration PRs and excluded PRs are not tickets.",
    limits:
      "Tickets whose issue GitHub did not return have no start and are left out. Time waiting in a batch or integration branch counts, since the ticket is not delivered until its PR reaches the default branch: a PR merged into an integration branch is done when that branch's integration PR merges.",
  },
};
