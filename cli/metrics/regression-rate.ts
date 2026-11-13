import type { Ticket } from "../linker.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { formatPercent, percent, plural, share, sum } from "./stats.ts";

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
  /**
   * Inferred regressions (reverts, blame), apart: never added to the declared
   * figures above. A regression also declared counts as declared only. Absent
   * from datasets written before they were read.
   */
  inferred?: {
    rate: number;
    regressions: number;
    regressedTickets: number;
    /** How many were found by each trace. */
    by: { revert: number; blame: number };
    /** Per ticket, the PRs that reverted or fixed it, and how each was found. Absent once anonymized. */
    perTicket?: { ticket: string; by: { pr: number; how: "revert" | "blame" }[] }[];
  };
}

export const regressionRate: Metric<RegressionRate> = {
  id: "regressionRate",
  name: "Regression rate",

  compute({ tickets, regressions, inferredRegressions }) {
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

    // Inferred ones, over these tickets, unless a declared regression is the same one: its issue closed by the reverting or fixing PR.
    const ours = new Set(tickets);
    const declaredSame = (cause: Ticket, by: { closes: number[] }) =>
      regressions.some((bug) => by.closes.includes(bug.number) && bug.causedBy.some((number) => byNumber.get(number) === cause));
    const inferred = (inferredRegressions ?? []).filter(({ cause, by }) => ours.has(cause) && !declaredSame(cause, by));
    const inferredPerTicket = tickets.flatMap((ticket) => {
      const found = inferred.filter(({ cause }) => cause === ticket).map(({ by, how }) => ({ pr: by.number, how }));
      return found.length ? [{ ticket: ticket.id, by: found }] : [];
    });
    return {
      value: {
        rate: share(perTicket.length, tickets.length),
        regressions: traced,
        regressedTickets: perTicket.length,
        untraced,
        perTicket,
        ...(inferredRegressions && {
          inferred: {
            rate: share(inferredPerTicket.length, tickets.length),
            regressions: inferred.length,
            regressedTickets: inferredPerTicket.length,
            by: { revert: inferred.filter(({ how }) => how === "revert").length, blame: inferred.filter(({ how }) => how === "blame").length },
            perTicket: inferredPerTicket,
          },
        }),
      },
      coverage,
    };
  },

  anonymize: ({ rate, regressions, regressedTickets, inferred }) => ({
    rate,
    regressions,
    regressedTickets,
    ...(inferred && { inferred: { rate: inferred.rate, regressions: inferred.regressions, regressedTickets: inferred.regressedTickets, by: inferred.by } }),
  }),

  figure: { label: "of tickets", of: ({ rate }) => percent(rate), format: formatPercent },

  sentence: ({ rate, regressions, regressedTickets }) =>
    `Regression rate of ${formatPercent(percent(rate))}: ${plural(regressions, "regression")} traced to ${plural(regressedTickets, "delivered ticket")}`,

  headline: {
    order: 4,
    card: ({ rate, regressions }) => `${formatPercent(percent(rate))} <small>${plural(regressions, "regression")}</small>`,
    pool(known) {
      const tickets = sum(known.map(({ coverage }) => coverage.tickets));
      if (tickets === 0) return undefined;
      const regressedTickets = sum(known.map(({ value }) => value.regressedTickets));
      return { rate: share(regressedTickets, tickets), regressions: sum(known.map(({ value }) => value.regressions)), regressedTickets };
    },
  },

  section({ untraced, regressions, regressedTickets, inferred }) {
    const traced = `<p><strong>${plural(regressions, "regression")}</strong> declared and traced to ${plural(regressedTickets, "delivered ticket")}.</p>`;
    const untracedText = untraced?.length ? `<p>Untraced, and left out of the rate: ${untraced.map((bug) => `#${String(bug)}`).join(", ")}.</p>` : "";
    const how = inferred ? [inferred.by.revert ? plural(inferred.by.revert, "revert") : "", inferred.by.blame ? `${String(inferred.by.blame)} from the history of the lines a fix changed` : ""].filter(Boolean).join(", ") : "";
    const inferredText = !inferred
      ? ""
      : inferred.regressions === 0
        ? "<p>None inferred from the history.</p>"
        : `<p>Inferred, apart: <strong>${formatPercent(percent(inferred.rate))}</strong> of tickets, ${plural(inferred.regressions, "regression")} on ${plural(inferred.regressedTickets, "ticket")}${how ? ` (${how})` : ""}. Never added to the declared figure.</p>`;
    return `${traced}${untracedText}${inferredText}`;
  },

  ticketTable: {
    columns: ["Regressions", "Regression issues"],
    rows: ({ perTicket }) =>
      perTicket?.map((row) => ({ id: row.ticket, cells: [{ text: String(row.bugs.length), sort: row.bugs.length }, row.bugs.map((bug) => `#${String(bug)}`).join(", ")] })),
  },

  methodology: {
    definition:
      "The share of delivered tickets that caused at least one regression, in two figures never added together. <strong>Declared</strong>: an issue labelled <code>regression</code> whose body, or one of its comments, has a line starting <code>caused-by: #N</code>. <code>#N</code> may name a ticket or a PR; a PR counts against its ticket. A regression naming several tickets counts against each. <strong>Inferred</strong>: a PR delivered to the default branch that reverts an earlier one (GitHub's <code>Reverts owner/repo#N</code> description, or a commit's <code>This reverts commit &lt;sha&gt;.</code> line naming a commit of an earlier PR) is a regression of that PR's ticket; reverting a revert is none. An inferred regression whose reverting PR closes a declared regression of the same ticket counts as declared only. The headline and the sentence quote the declared figure.",
    limits:
      "Only bugs someone traced count: a bug without the <code>regression</code> label or a <code>caused-by:</code> line is not a regression here, so the rate is a floor. Regressions whose <code>caused-by:</code> is missing or names work not merged into the default branch are listed as untraced and left out of the rate. Recent tickets have had less time to show regressions. A revert is not always a regression (a feature switched off on purpose reverts too), and a revert pushed straight to the default branch, outside a PR, is not seen.",
  },
};
