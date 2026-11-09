import { batchDiffCommits, hasOwnDiff, type Ticket } from "../linker.ts";
import { escapeHtml } from "./html.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { plural } from "./stats.ts";

/** A count of lines changed with its sign, `+` for growth: `+102,751`, `−90`, `0`. */
function signed(lines: number): string {
  const digits = Math.abs(lines).toLocaleString("en-US");
  return lines > 0 ? `+${digits}` : lines < 0 ? `\u2212${digits}` : digits;
}

function count(lines: number): string {
  return lines.toLocaleString("en-US");
}

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

// Shown as "Net lines changed", lines added minus lines deleted, signed so that
// growth reads `+`. The id and the `netLinesRemoved` field (deleted minus added)
// keep their names and sign: published datasets use them.
export const netLinesRemoved: Metric<NetLinesRemoved> = {
  id: "netLinesRemoved",
  name: "Net lines changed",

  compute({ tickets, pullRequests }) {
    // A ticket an integration PR alone delivered, with no commit of it credited, has no diff of its own.
    const coverage = { tickets: tickets.filter(hasOwnDiff).length, of: tickets.length };
    // Over no ticket with a diff, the totals would read as 0: unknown, not zero.
    if (coverage.tickets === 0) return { value: UNKNOWN, coverage };
    // Commits credited from a batch belong to one ticket only, which has no PR: none is counted twice.
    const credited = tickets.flatMap(batchDiffCommits);
    const linesAdded = sum(pullRequests.map((pr) => pr.additions)) + sum(credited.map((commit) => commit.additions));
    const linesDeleted = sum(pullRequests.map((pr) => pr.deletions)) + sum(credited.map((commit) => commit.deletions));
    const rows = tickets.filter(hasOwnDiff).map((ticket) => ({ ticket: ticket.id, ...linesOf(ticket) }));
    const ticketsNetRemoving = rows.filter((row) => row.linesDeleted > row.linesAdded).length;
    return { value: { linesAdded, linesDeleted, netLinesRemoved: linesDeleted - linesAdded, ticketsNetRemoving, tickets: rows }, coverage };
  },

  // Per-ticket rows name tickets: an anonymized dataset keeps the totals only.
  anonymize: ({ linesAdded, linesDeleted, netLinesRemoved, ticketsNetRemoving }) => ({ linesAdded, linesDeleted, netLinesRemoved, ticketsNetRemoving }),

  // The figure stays lines removed, as trends in published datasets hold it; it is shown as lines changed.
  figure: { label: "net", of: ({ netLinesRemoved }) => netLinesRemoved, format: (removed) => signed(-removed) },

  sentence: ({ linesAdded, linesDeleted, ticketsNetRemoving }) =>
    `Net lines changed: ${signed(linesAdded - linesDeleted)} (${count(linesAdded)} added, ${count(linesDeleted)} deleted); ${plural(ticketsNetRemoving, "ticket")} removed more code than ${ticketsNetRemoving === 1 ? "it" : "they"} added`,

  section({ linesAdded, linesDeleted, ticketsNetRemoving, tickets }) {
    const summary = `<p><strong>${signed(linesAdded - linesDeleted)}</strong> net lines changed: ${count(linesAdded)} added, ${count(linesDeleted)} deleted. Tickets removing more than they added: ${String(ticketsNetRemoving)}.</p>`;
    if (!tickets?.length) return summary;
    const rows = tickets
      .map((t) => `<tr><td>${escapeHtml(t.ticket)}</td><td>${count(t.linesAdded)}</td><td>${count(t.linesDeleted)}</td><td>${signed(t.linesAdded - t.linesDeleted)}</td></tr>`)
      .join("");
    return `${summary}<table><thead><tr><th>Ticket</th><th>Added</th><th>Deleted</th><th>Net change</th></tr></thead><tbody>${rows}</tbody></table>`;
  },

  methodology: {
    definition:
      "Lines added minus lines deleted over every PR merged into the default branch, each PR counted once, and over the integration PR commits credited to tickets with no PR of their own (see Autonomy level), merges left out; shown with a sign, + when the code grew and − when it shrank. Also counts the tickets whose PRs together deleted more lines than they added. A full dataset lists each ticket's lines over its own PRs; a PR delivering two tickets counts in both rows, but once in the totals. The dataset keeps this metric's original id, <code>netLinesRemoved</code>, and its field of that name holds lines deleted minus lines added (negative when the code grew), as do its trends and comparison by autonomy level. When no ticket has a diff of its own (every ticket delivered by an integration PR with no commit credited to it), it is unknown, not zero.",
    limits:
      "Counts every changed line as GitHub's diff stats report it, generated files and lockfiles included. PRs merged into other branches count only through the PR that lands them on the default branch. Integration PR commits credited to no ticket, and conflict resolutions in merges, are not counted.",
  },
};

/** A ticket's lines over its own PRs, else over the batch commits credited to it. */
function linesOf(ticket: Ticket): { linesAdded: number; linesDeleted: number } {
  const changes = ticket.pullRequests.length > 0 ? ticket.pullRequests : batchDiffCommits(ticket);
  return { linesAdded: sum(changes.map((change) => change.additions)), linesDeleted: sum(changes.map((change) => change.deletions)) };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
