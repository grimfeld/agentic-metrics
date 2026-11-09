import { estimateHours } from "../conventions.ts";
import type { Comment } from "../github/load.ts";
import type { Ticket } from "../linker.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { SIZE_HEADERS, sizeCells, sizeOf, type TicketSize } from "./size.ts";
import { formatHours, percentile } from "./stats.ts";

export interface EstimatedTicket extends TicketSize {
  estimateHours: number;
  /** From the first commit on any of its PRs to its last PR merging. */
  actualHours: number;
  /** Actual over estimate, to two decimals: above 1 took longer than estimated. */
  ratio: number;
}

export interface EstimateVsActual {
  p50Ratio: number;
  /** Tickets whose estimate came after the first commit, so left out. */
  excludedLate: number;
  tickets: EstimatedTicket[];
}


/** The earliest estimate posted by a person, in hours. */
function estimateOf(comments: readonly Comment[]): { at: Date; hours: number } | undefined {
  for (const comment of comments) {
    if (comment.byBot) continue;
    const hours = estimateHours(comment.body);
    if (hours !== undefined) return { at: comment.at, hours };
  }
  return undefined;
}

function firstCommitAt(ticket: Ticket): Date | undefined {
  const times = ticket.pullRequests.flatMap((pr) => (pr.firstCommitAt ? [pr.firstCommitAt.getTime()] : []));
  return times.length > 0 ? new Date(Math.min(...times)) : undefined;
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

export const estimateVsActual: Metric<EstimateVsActual> = {
  id: "estimateVsActual",
  name: "Estimate vs actual",

  compute({ tickets }) {
    const estimated: EstimatedTicket[] = [];
    let excludedLate = 0;
    for (const ticket of tickets) {
      const estimate = ticket.issue && estimateOf(ticket.issue.comments);
      const start = firstCommitAt(ticket);
      if (!estimate || !start) continue;
      if (estimate.at >= start) {
        excludedLate++;
        continue;
      }
      const actualHours = (ticket.doneAt.getTime() - start.getTime()) / 3_600_000;
      const { ticket: id, ...size } = sizeOf(ticket);
      estimated.push({
        ticket: id,
        estimateHours: round(estimate.hours, 1),
        actualHours: round(actualHours, 1),
        ratio: round(actualHours / estimate.hours, 2),
        ...size,
      });
    }
    const coverage = { tickets: estimated.length, of: tickets.length };
    if (estimated.length === 0) return { value: UNKNOWN, coverage };
    return { value: { p50Ratio: percentile(estimated.map((row) => row.ratio), 50), excludedLate, tickets: estimated }, coverage };
  },

  // Per-ticket rows name tickets: an anonymized dataset keeps the medians only.
  anonymize: (value) => ({ ...value, tickets: [] }),

  figure: { label: "p50 actual / estimate", of: ({ p50Ratio }) => p50Ratio, format: String },

  sentence: ({ p50Ratio }) => `Tickets took a median ${String(p50Ratio)} times their up-front estimate`,

  section({ p50Ratio, excludedLate, tickets }) {
    const rows = tickets
      .map(
        (t) =>
          `<tr><td>${t.ticket}</td><td>${formatHours(t.estimateHours)}</td><td>${formatHours(t.actualHours)}</td><td>${String(t.ratio)}</td>${sizeCells(t)}</tr>`,
      )
      .join("");
    const median = `<p>Median actual / estimate: <strong>${String(p50Ratio)}</strong>. Left out because the estimate came after the first commit: ${String(excludedLate)}.</p>`;
    if (tickets.length === 0) return median;
    return `${median}
<table><thead><tr><th>Ticket</th><th>Estimate</th><th>Actual</th><th>Actual / estimate</th>${SIZE_HEADERS}</tr></thead><tbody>${rows}</tbody></table>`;
  },

  methodology: {
    definition:
      "A ticket's estimate is the earliest comment on its issue with a line starting <code>estimate: &lt;n&gt;&lt;h|d|w&gt;</code> (for example <code>estimate: 2d</code>); later revisions never replace it, and comments by bots are ignored. Days and weeks are calendar time (24 h, 168 h). Actual time runs from the first commit on any of the ticket's PRs to its last PR merging into the default branch. The figure is the median of actual divided by estimate, shown beside each ticket's size proxies.",
    limits:
      "Estimates are self-reported and optional. An estimate counts only when posted before the ticket's first commit; later ones are left out of coverage. Commit dates come from git and can be set by their author. Actual time is elapsed time, not hours worked.",
  },
};
