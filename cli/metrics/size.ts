import type { Ticket } from "../linker.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { percentile } from "./stats.ts";

export interface TicketSize {
  ticket: string;
  /** Lines added plus lines deleted over its PRs. */
  diffLines: number;
  /** Distinct files changed by its PRs. */
  filesTouched: number;
  /** Sub-issues of its issue; null when GitHub did not return the issue. */
  subTickets: number | null;
}

export interface Size {
  p50DiffLines: number;
  p50FilesTouched: number;
  tickets: TicketSize[];
}

/** A ticket's size proxies. */
export function sizeOf(ticket: Ticket): TicketSize {
  const prs = ticket.pullRequests;
  const diffLines = prs.reduce((total, pr) => total + pr.additions + pr.deletions, 0);
  const filesTouched = prs.every((pr) => pr.filesComplete)
    ? new Set(prs.flatMap((pr) => pr.files.map((file) => file.path))).size
    : prs.reduce((total, pr) => total + pr.changedFiles, 0);
  // A PR that is its own ticket has no sub-tickets; an issue GitHub did not return has unknown ones.
  const subTickets = ticket.issue ? ticket.issue.subIssues : ticket.id.startsWith("PR ") ? 0 : null;
  return { ticket: ticket.id, diffLines, filesTouched, subTickets };
}

export const size: Metric<Size> = {
  id: "size",
  name: "Ticket size",

  compute({ tickets }) {
    const coverage = { tickets: tickets.length, of: tickets.length };
    if (tickets.length === 0) return { value: UNKNOWN, coverage };
    const sizes = tickets.map(sizeOf);
    return {
      value: {
        p50DiffLines: percentile(sizes.map((s) => s.diffLines), 50),
        p50FilesTouched: percentile(sizes.map((s) => s.filesTouched), 50),
        tickets: sizes,
      },
      coverage,
    };
  },

  // Per-ticket rows name tickets: an anonymized dataset keeps the medians only.
  anonymize: (value) => ({ ...value, tickets: [] }),

  section({ p50DiffLines, p50FilesTouched, tickets }) {
    const rows = tickets
      .map((t) => `<tr><td>${t.ticket}</td>${sizeCells(t)}</tr>`)
      .join("");
    const median = `<p>Median ticket: ${String(p50DiffLines)} lines changed in ${String(p50FilesTouched)} files.</p>`;
    if (tickets.length === 0) return median;
    return `${median}
<table><thead><tr><th>Ticket</th>${SIZE_HEADERS}</tr></thead><tbody>${rows}</tbody></table>`;
  },

  methodology: {
    definition:
      "Size proxies per ticket, for judging effort without an estimate: diff size (lines added plus lines deleted over its PRs merged into the default branch), files touched (distinct files those PRs changed) and sub-tickets (the issue's GitHub sub-issues). The headline is the median (nearest rank) over tickets.",
    limits:
      "Diff size includes generated files and lockfiles. GitHub lists at most 100 files per PR; when a PR changes more, files touched adds up each PR's file count, so a file changed by two PRs counts twice. A PR that closes no issue has no sub-tickets.",
  },
};

export const SIZE_HEADERS = "<th>Diff lines</th><th>Files</th><th>Sub-tickets</th>";

export function sizeCells(t: TicketSize): string {
  return `<td>${String(t.diffLines)}</td><td>${String(t.filesTouched)}</td><td>${t.subTickets === null ? UNKNOWN : String(t.subTickets)}</td>`;
}
