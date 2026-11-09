import type { Ticket } from "../linker.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { formatPercent, percent } from "./stats.ts";

export interface RegressionRate {
  /** Share of delivered tickets with at least one regression traced to them, 0 to 1. */
  rate: number;
  /** Regressions traced to a delivered ticket. */
  regressions: number;
  regressedTickets: number;
  /** Regression issues whose `caused-by:` is missing or names no delivered ticket or PR. */
  /** Absent once anonymized. */
  untraced?: number[];
  /** The tickets with regressions, in delivery order, with the bug issues traced to each. Absent once anonymized. */
  perTicket?: { ticket: string; bugs: number[] }[];
}

export const regressionRate: Metric<RegressionRate> = {
  id: "regressionRate",
  name: "Regression rate",

  compute({ tickets, regressions }) {
    const coverage = { tickets: tickets.length, of: tickets.length };
    if (tickets.length === 0) return { value: UNKNOWN, coverage };

    // `#N` names an issue that is a ticket, or a PR, which resolves to its ticket.
    const byNumber = new Map<number, Ticket>();
    for (const ticket of tickets) {
      for (const pr of ticket.pullRequests) byNumber.set(pr.number, ticket);
      const issueNumber = /^#(\d+)$/.exec(ticket.id)?.[1];
      if (issueNumber) byNumber.set(Number(issueNumber), ticket);
    }

    const bugs = new Map<Ticket, number[]>();
    const untraced: number[] = [];
    let traced = 0;
    for (const bug of [...regressions].sort((a, b) => a.number - b.number)) {
      const causes = new Set(bug.causedBy.flatMap((number) => byNumber.get(number) ?? []));
      if (causes.size === 0) untraced.push(bug.number);
      else traced++;
      for (const ticket of causes) bugs.set(ticket, [...(bugs.get(ticket) ?? []), bug.number]);
    }

    const perTicket = tickets.flatMap((ticket) => {
      const numbers = bugs.get(ticket);
      return numbers ? [{ ticket: ticket.id, bugs: numbers }] : [];
    });
    return {
      value: {
        rate: Math.round((perTicket.length / tickets.length) * 1000) / 1000,
        regressions: traced,
        regressedTickets: perTicket.length,
        untraced,
        perTicket,
      },
      coverage,
    };
  },

  anonymize: ({ rate, regressions, regressedTickets }) => ({ rate, regressions, regressedTickets }),

  figure: { label: "of tickets", of: ({ rate }) => percent(rate), format: formatPercent },

  sentence: ({ rate, regressions, regressedTickets }) =>
    `Regression rate of ${formatPercent(percent(rate))}: ${String(regressions)} regression${regressions === 1 ? "" : "s"} traced to ${String(regressedTickets)} delivered ticket${regressedTickets === 1 ? "" : "s"}`,

  headline({ rate, regressions }) {
    return `${String(Math.round(rate * 1000) / 10)}% <small>${String(regressions)} regression${regressions === 1 ? "" : "s"}</small>`;
  },

  section({ perTicket, untraced, regressions, regressedTickets }) {
    if (!perTicket || !untraced) {
      return `<p>${String(regressions)} regression${regressions === 1 ? "" : "s"} traced to ${String(regressedTickets)} ticket${regressedTickets === 1 ? "" : "s"}.</p>`;
    }
    const rows = perTicket
      .map((row) => `<tr><td>${row.ticket}</td><td>${row.bugs.map((bug) => `#${String(bug)}`).join(", ")}</td></tr>`)
      .join("");
    const table = perTicket.length
      ? `<table><thead><tr><th>Ticket</th><th>Regressions</th></tr></thead><tbody>${rows}</tbody></table>`
      : "<p>No regression traced to a delivered ticket.</p>";
    const rest = untraced.length
      ? `<p>Untraced: ${untraced.map((bug) => `#${String(bug)}`).join(", ")}</p>`
      : "";
    return table + rest;
  },

  methodology: {
    definition:
      "The share of delivered tickets that caused at least one regression. A regression is an issue labelled <code>regression</code> whose body, or one of its comments, has a line starting <code>caused-by: #N</code>. <code>#N</code> may name a ticket or a PR; a PR counts against its ticket. A regression naming several tickets counts against each.",
    limits:
      "Only bugs someone traced count: a bug without the <code>regression</code> label or a <code>caused-by:</code> line is not a regression here, so the rate is a floor. Regressions whose <code>caused-by:</code> is missing or names work not merged into the default branch are listed as untraced and left out of the rate. Recent tickets have had less time to show regressions.",
  },
};
