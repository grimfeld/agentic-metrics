// Attempts per ticket: the PRs opened to deliver it, merged or abandoned
// (GLOSSARY.md), and what abandoned attempts cost where transcripts show it.
// Issues whose PRs were all abandoned are undelivered work, counted apart:
// they are no ticket.
import type { Ticket } from "../linker.ts";
import { responseCost } from "../pricing/cost.ts";
import { CURRENT_PRICE_TABLE } from "../pricing/price-table.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { percentile, plural, round, sum } from "./stats.ts";

export interface Attempts {
  p50: number;
  mean: number;
  /** Tickets with at least one abandoned PR. */
  retried: number;
  /** Abandoned PRs on delivered tickets. */
  abandoned: number;
  /** Issues whose PRs were all abandoned. */
  undelivered: number;
  /**
   * API-equivalent cost, in USD, of the sessions that ran only on abandoned
   * PRs' branches; over the tickets whose abandoned attempts have such sessions.
   * Absent when none has.
   */
  abandonedCost?: { usd: number; tickets: number };
  /** Per ticket, in delivery order. Absent once anonymized. */
  perTicket?: { ticket: string; attempts: number; abandoned: number }[];
}

/** A ticket's attempts: its delivered PRs (one for a ticket only a batch delivered) and its abandoned ones. */
function attemptsOf(ticket: Ticket): number {
  return Math.max(ticket.pullRequests.length, 1) + (ticket.abandonedPullRequests?.length ?? 0);
}

/** What the sessions that ran only on a ticket's abandoned branches cost; undefined when none did or one is unpriced. */
function abandonedCost(ticket: Ticket): number | undefined {
  const abandoned = new Set((ticket.abandonedPullRequests ?? []).map((pr) => pr.headRefName));
  const delivered = new Set(ticket.pullRequests.map((pr) => pr.headRefName));
  const sessions = ticket.sessions.filter((session) => {
    const branches = [...session.branches.keys()];
    return branches.some((branch) => abandoned.has(branch)) && !branches.some((branch) => delivered.has(branch));
  });
  const responses = new Map(sessions.flatMap((session) => session.responses).map((response) => [response.id, response]));
  if (responses.size === 0) return undefined;
  let usd = 0;
  for (const response of responses.values()) {
    const cost = responseCost(CURRENT_PRICE_TABLE, response);
    if (cost === undefined) return undefined;
    usd += cost;
  }
  return usd;
}

export const attempts: Metric<Attempts> = {
  id: "attempts",
  name: "Attempts per ticket",

  compute({ tickets, undelivered }) {
    const coverage = { tickets: tickets.length, of: tickets.length };
    // Abandoned PRs are read with the history; work linked before they were has no attempts to count.
    if (tickets.length === 0 || tickets.some((ticket) => ticket.abandonedPullRequests === undefined)) return { value: UNKNOWN, coverage };
    const perTicket = tickets.map((ticket) => ({ ticket: ticket.id, attempts: attemptsOf(ticket), abandoned: ticket.abandonedPullRequests?.length ?? 0 }));
    const counts = perTicket.map((row) => row.attempts);
    const costs = tickets.flatMap((ticket) => {
      const usd = abandonedCost(ticket);
      return usd === undefined ? [] : [usd];
    });
    return {
      value: {
        p50: percentile(counts, 50),
        mean: round(sum(counts) / counts.length, 2),
        retried: perTicket.filter((row) => row.abandoned > 0).length,
        abandoned: sum(perTicket.map((row) => row.abandoned)),
        undelivered: undelivered?.length ?? 0,
        ...(costs.length > 0 && { abandonedCost: { usd: round(sum(costs), 2), tickets: costs.length } }),
        perTicket,
      },
      coverage,
    };
  },

  anonymize: ({ p50, mean, retried, abandoned, undelivered, abandonedCost: cost }) => ({ p50, mean, retried, abandoned, undelivered, ...(cost && { abandonedCost: cost }) }),

  figure: { label: "mean", of: ({ mean }) => mean, format: (value) => String(round(value, 2)) },

  chart: {
    title: "Attempts",
    draw: ({ value: { retried, abandoned, undelivered } }) => ({
      kind: "comparison",
      data: [
        { label: "Tickets retried", value: retried },
        { label: "Abandoned PRs", value: abandoned },
        { label: "Undelivered issues", value: undelivered },
      ],
      format: String,
      heads: ["", "Count"],
      description: `${plural(retried, "ticket")} needed more than one PR; ${plural(abandoned, "PR")} abandoned on delivered tickets, and ${plural(undelivered, "issue")} never delivered.`,
    }),
  },

  section({ mean, retried, abandoned, undelivered, abandonedCost: cost }) {
    const spent = cost ? `<p>The sessions that worked only on abandoned PRs cost <strong>$${cost.usd.toFixed(2)}</strong> (API equivalent), over ${plural(cost.tickets, "ticket")} with such transcripts.</p>` : "";
    return `<p>A mean of <strong>${String(mean)}</strong> PRs per ticket: ${plural(retried, "ticket")} with ${plural(abandoned, "abandoned PR")}.</p>
<p><strong>${plural(undelivered, "issue")}</strong> had only abandoned PRs: undelivered work, counted apart from tickets.</p>${spent}`;
  },

  ticketTable: {
    columns: ["Attempts", "Abandoned"],
    rows: ({ perTicket }) =>
      perTicket?.map((row) => ({ id: row.ticket, cells: [{ text: String(row.attempts), sort: row.attempts }, { text: String(row.abandoned), sort: row.abandoned }] })),
  },

  sentence: ({ mean, retried }) => (retried > 0 ? `A mean of ${String(mean)} pull requests per delivered ticket, ${plural(retried, "ticket")} needing more than one` : undefined),

  methodology: {
    definition:
      "A ticket's attempts are the PRs opened to deliver it: its delivered PRs (one for a ticket only a batch delivered) and its <strong>abandoned</strong> PRs, closed without merging. An abandoned PR is linked to an issue as a merged one is: its closing references, else the issue number in its branch (per-repo pattern), else <code>(#N)</code> in its commit subjects; PRs from excluded authors or branches, and integration PRs, are left out. An issue whose PRs were all abandoned is <strong>undelivered work</strong>: it is no ticket, and is counted apart. The cost of abandoned attempts is the API-equivalent cost of the sessions that ran on an abandoned PR's branch and on none of the ticket's delivered PRs' branches.",
    limits:
      "A PR closed and reopened, or replaced by a new PR for reasons other than failure (a rebase onto a fresh branch), counts as an attempt all the same. An issue closed with no PR at all is not undelivered work here. The cost of abandoned attempts is known only where their sessions' transcripts are cached, and a session that worked on both an abandoned and a delivered branch counts on the delivered side.",
  },
};
