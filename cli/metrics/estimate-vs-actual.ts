import { estimateHours } from "../conventions.ts";
import type { Comment } from "../github/load.ts";
import { ownCommits, type Ticket } from "../linker.ts";
import { perTicketChart } from "../report/charts.ts";
import type { Figure, Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { SIZE_COLUMNS, sizeCells, sizeOf, type TicketSize } from "./size.ts";
import { formatHours, hoursBetween, percentile, plural, round } from "./stats.ts";

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

/** The first commit of its PRs, else of the batch commits credited to it. */
function firstCommitAt(ticket: Ticket): Date | undefined {
  const times =
    ticket.pullRequests.length > 0
      ? ticket.pullRequests.flatMap((pr) => (pr.firstCommitAt ? [pr.firstCommitAt.getTime()] : []))
      : ownCommits(ticket).flatMap((commit) => (commit.authoredAt ? [commit.authoredAt.getTime()] : []));
  return times.length > 0 ? new Date(Math.min(...times)) : undefined;
}

const ESTIMATE_FIGURE: Figure<EstimateVsActual> = { label: "p50 actual / estimate", of: ({ p50Ratio }) => p50Ratio, format: String };

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
      const actualHours = hoursBetween(start, ticket.doneAt);
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

  figure: ESTIMATE_FIGURE,

  // One dot per ticket against the estimate (1); an anonymized dataset keeps no ticket, so its monthly medians.
  chart: {
    title: "Actual / estimate per ticket",
    draw(input) {
      const { p50Ratio, tickets } = input.value;
      return perTicketChart(input, ESTIMATE_FIGURE, {
        what: "Estimate vs actual",
        rows: tickets.map((t) => ({ ticket: t.ticket, value: t.ratio })),
        head: "Actual / estimate",
        markers: [
          { label: "p50", value: p50Ratio },
          { label: "estimate", value: 1 },
        ],
        format: String,
        description: (rows) =>
          `Actual time over the estimate for each of ${plural(rows.length, "ticket")}, ${String(rows.filter((row) => row.value > 1).length)} over 1 (took longer than estimated): p50 ${String(p50Ratio)}.`,
      });
    },
  },

  sentence: ({ p50Ratio }) => `Tickets took a median ${String(p50Ratio)} times their up-front estimate`,

  section: ({ p50Ratio, excludedLate }) =>
    `<p>Median actual / estimate: <strong>${String(p50Ratio)}</strong>. Left out because the estimate came after the first commit: ${String(excludedLate)}.</p>`,

  ticketTable: {
    columns: ["Estimate", "Actual", "Actual / estimate", ...SIZE_COLUMNS],
    rows: ({ tickets }) =>
      tickets.map((t) => ({
        id: t.ticket,
        cells: [
          { text: formatHours(t.estimateHours), sort: t.estimateHours },
          { text: formatHours(t.actualHours), sort: t.actualHours },
          { text: String(t.ratio), sort: t.ratio },
          ...sizeCells(t),
        ],
      })),
  },

  methodology: {
    definition:
      "A ticket's estimate is the earliest comment on its issue with a line starting <code>estimate: &lt;n&gt;&lt;h|d|w&gt;</code> (for example <code>estimate: 2d</code>); later revisions never replace it, and comments by bots are ignored. Days and weeks are calendar time (24 h, 168 h). Actual time runs from the first commit on any of the ticket's PRs (for a ticket with no PR of its own, the first integration PR commit credited to it; see Autonomy level) to its last PR merging into the default branch. The figure is the median of actual divided by estimate, shown beside each ticket's size proxies.",
    limits:
      "Estimates are self-reported and optional. An estimate counts only when posted before the ticket's first commit; later ones are left out of coverage. Commit dates come from git and can be set by their author. Actual time is elapsed time, not hours worked.",
  },
};
