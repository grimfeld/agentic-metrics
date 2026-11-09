import { escapeHtml } from "./html.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { plural } from "./stats.ts";

export interface NetLinesRemoved {
  linesAdded: number;
  linesDeleted: number;
  /** Lines deleted minus lines added: negative when the code grew. */
  netLinesRemoved: number;
  /** Tickets whose PRs together deleted more lines than they added. */
  ticketsNetRemoving: number;
  /** Each ticket's lines over its own PRs, in delivery order. Absent once anonymized. */
  tickets?: { ticket: string; linesAdded: number; linesDeleted: number }[];
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
    const rows = tickets
      .filter((ticket) => ticket.pullRequests.length > 0)
      .map((ticket) => ({
        ticket: ticket.id,
        linesAdded: sum(ticket.pullRequests.map((pr) => pr.additions)),
        linesDeleted: sum(ticket.pullRequests.map((pr) => pr.deletions)),
      }));
    const ticketsNetRemoving = rows.filter((row) => row.linesDeleted > row.linesAdded).length;
    return { value: { linesAdded, linesDeleted, netLinesRemoved: linesDeleted - linesAdded, ticketsNetRemoving, tickets: rows }, coverage };
  },

  // Per-ticket rows name tickets: an anonymized dataset keeps the totals only.
  anonymize: ({ linesAdded, linesDeleted, netLinesRemoved, ticketsNetRemoving }) => ({ linesAdded, linesDeleted, netLinesRemoved, ticketsNetRemoving }),

  figure: { label: "net removed", of: ({ netLinesRemoved }) => netLinesRemoved, format: String },

  sentence: ({ linesAdded, linesDeleted, ticketsNetRemoving }) =>
    `${String(linesDeleted)} lines deleted for ${String(linesAdded)} added; ${plural(ticketsNetRemoving, "ticket")} removed more code than ${ticketsNetRemoving === 1 ? "it" : "they"} added`,

  section({ linesAdded, linesDeleted, netLinesRemoved, ticketsNetRemoving, tickets }) {
    const summary = `<p><strong>${String(netLinesRemoved)}</strong> net lines removed: ${String(linesDeleted)} deleted, ${String(linesAdded)} added. Tickets removing more than they added: ${String(ticketsNetRemoving)}.</p>`;
    if (!tickets?.length) return summary;
    const rows = tickets
      .map((t) => `<tr><td>${escapeHtml(t.ticket)}</td><td>${String(t.linesAdded)}</td><td>${String(t.linesDeleted)}</td><td>${String(t.linesDeleted - t.linesAdded)}</td></tr>`)
      .join("");
    return `${summary}<table><thead><tr><th>Ticket</th><th>Added</th><th>Deleted</th><th>Net removed</th></tr></thead><tbody>${rows}</tbody></table>`;
  },

  methodology: {
    definition:
      "Lines deleted minus lines added over every PR merged into the default branch, each PR counted once; negative when the code grew. Also counts the tickets whose PRs together deleted more lines than they added. A full dataset lists each ticket's lines over its own PRs; a PR delivering two tickets counts in both rows, but once in the totals.",
    limits:
      "Counts every changed line as GitHub's diff stats report it, generated files and lockfiles included. PRs merged into other branches count only through the PR that lands them on the default branch.",
  },
};

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
