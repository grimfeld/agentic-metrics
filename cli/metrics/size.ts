import { batchDiffCommits, hasOwnDiff, type Ticket } from "../linker.ts";
import { perTicketChart, spanText } from "../report/charts.ts";
import type { Figure, Metric, TableCell } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { percentile, plural } from "./stats.ts";

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
  // A ticket only integration PRs delivered: the commits credited to it, each file count added up.
  const commits = batchDiffCommits(ticket);
  const diffLines =
    prs.reduce((total, pr) => total + pr.additions + pr.deletions, 0) +
    commits.reduce((total, commit) => total + commit.additions + commit.deletions, 0);
  const filesTouched =
    commits.length > 0
      ? commits.reduce((total, commit) => total + (commit.changedFiles ?? 0), 0)
      : prs.every((pr) => pr.filesComplete)
        ? new Set(prs.flatMap((pr) => pr.files.map((file) => file.path))).size
        : prs.reduce((total, pr) => total + pr.changedFiles, 0);
  // A PR that is its own ticket has no sub-tickets; an issue GitHub did not return has unknown ones.
  const subTickets = ticket.issue ? ticket.issue.subIssues : ticket.id.startsWith("PR ") ? 0 : null;
  return { ticket: ticket.id, diffLines, filesTouched, subTickets };
}

/** The size proxies' columns of a per-ticket table, with `sizeCells`. */
export const SIZE_COLUMNS = ["Diff lines", "Files", "Sub-tickets"] as const;

const SIZE_FIGURE: Figure<Size> = { label: "p50 diff lines", of: ({ p50DiffLines }) => p50DiffLines, format: String };

export const size: Metric<Size> = {
  id: "size",
  name: "Ticket size",

  compute({ tickets }) {
    // A ticket an integration PR alone delivered, with no commit of it credited, has no diff of its own.
    const sized = tickets.filter(hasOwnDiff);
    const coverage = { tickets: sized.length, of: tickets.length };
    if (sized.length === 0) return { value: UNKNOWN, coverage };
    const sizes = sized.map(sizeOf);
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

  figure: SIZE_FIGURE,

  // One dot per ticket; an anonymized dataset keeps no ticket, so its monthly medians.
  chart: {
    title: "Diff lines per ticket",
    draw(input) {
      const { p50DiffLines, tickets } = input.value;
      return perTicketChart(input, SIZE_FIGURE, {
        what: "Ticket size",
        rows: tickets.map((t) => ({ ticket: t.ticket, value: t.diffLines })),
        head: "Diff lines",
        markers: [{ label: "p50", value: p50DiffLines }],
        format: String,
        description: (rows) => `Diff lines of each of ${plural(rows.length, "ticket")}, ${spanText(rows, String)}: p50 ${String(p50DiffLines)}.`,
      });
    },
  },

  sentence: ({ p50DiffLines, p50FilesTouched }) =>
    `A median ticket of ${String(p50DiffLines)} changed lines across ${String(p50FilesTouched)} files`,

  section: ({ p50DiffLines, p50FilesTouched }) =>
    `<p>Median ticket: <strong>${String(p50DiffLines)}</strong> lines changed in <strong>${String(p50FilesTouched)}</strong> files.</p>`,

  ticketTable: {
    columns: SIZE_COLUMNS,
    rows: ({ tickets }) => tickets.map((t) => ({ id: t.ticket, cells: sizeCells(t) })),
  },

  methodology: {
    definition:
      "Size proxies per ticket, for judging effort without an estimate: diff size (lines added plus lines deleted over its PRs merged into the default branch, or, for a ticket with no PR of its own, over the integration PR commits credited to it), files touched (distinct files those PRs changed) and sub-tickets (the issue's GitHub sub-issues). The headline is the median (nearest rank) over tickets.",
    limits:
      "Diff size includes generated files and lockfiles. GitHub lists at most 100 files per PR; when a PR changes more, files touched adds up each PR's file count, so a file changed by two PRs counts twice. A PR that closes no issue has no sub-tickets. A ticket delivered only through an integration PR is sized on the commits of that PR credited to it (see Autonomy level), merges left out; its files touched add up each commit's file count, so a file changed by two commits counts twice. Such a ticket with no commit credited is left out.",
  },
};

export function sizeCells(t: TicketSize): TableCell[] {
  return [
    { text: String(t.diffLines), sort: t.diffLines },
    { text: String(t.filesTouched), sort: t.filesTouched },
    t.subTickets === null ? UNKNOWN : { text: String(t.subTickets), sort: t.subTickets },
  ];
}
