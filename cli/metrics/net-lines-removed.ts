import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";

export interface NetLinesRemoved {
  linesAdded: number;
  linesDeleted: number;
  /** Lines deleted minus lines added: negative when the code grew. */
  netLinesRemoved: number;
  /** Tickets whose PRs together deleted more lines than they added. */
  ticketsNetRemoving: number;
}

export const netLinesRemoved: Metric<NetLinesRemoved> = {
  id: "netLinesRemoved",
  name: "Net lines removed",

  compute({ tickets, pullRequests }) {
    // A ticket an integration PR alone delivered has no diff of its own.
    const coverage = { tickets: tickets.filter((ticket) => ticket.pullRequests.length > 0).length, of: tickets.length };
    if (tickets.length === 0) return { value: UNKNOWN, coverage };
    const linesAdded = sum(pullRequests.map((pr) => pr.additions));
    const linesDeleted = sum(pullRequests.map((pr) => pr.deletions));
    const ticketsNetRemoving = tickets.filter((ticket) => sum(ticket.pullRequests.map((pr) => pr.deletions - pr.additions)) > 0).length;
    return { value: { linesAdded, linesDeleted, netLinesRemoved: linesDeleted - linesAdded, ticketsNetRemoving }, coverage };
  },

  anonymize: (value) => value,

  figure: { label: "net removed", of: ({ netLinesRemoved }) => netLinesRemoved, format: String },

  sentence: ({ linesAdded, linesDeleted, ticketsNetRemoving }) =>
    `${String(linesDeleted)} lines deleted for ${String(linesAdded)} added; ${String(ticketsNetRemoving)} ticket${ticketsNetRemoving === 1 ? "" : "s"} removed more code than they added`,

  section({ linesAdded, linesDeleted, netLinesRemoved, ticketsNetRemoving }) {
    return `<p><strong>${String(netLinesRemoved)}</strong> net lines removed: ${String(linesDeleted)} deleted, ${String(linesAdded)} added. Tickets removing more than they added: ${String(ticketsNetRemoving)}.</p>`;
  },

  methodology: {
    definition:
      "Lines deleted minus lines added over every PR merged into the default branch, each PR counted once; negative when the code grew. Also counts the tickets whose PRs together deleted more lines than they added.",
    limits:
      "Counts every changed line as GitHub's diff stats report it, generated files and lockfiles included. PRs merged into other branches count only through the PR that lands them on the default branch.",
  },
};

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
