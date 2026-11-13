// Regression timing: how long a regression took to be found, after the ticket
// that caused it was delivered, and to be fixed, once found. Declared and
// inferred regressions apart, as the regression rate keeps them.
import type { Ticket } from "../linker.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { formatDuration, hoursBetween, percentile, plural } from "./stats.ts";

export interface Timing {
  /** Hours from the cause's delivery to the regression being found, over the regressions found after it. */
  found?: { p50Hours: number; p90Hours: number; regressions: number };
  /** Hours from found to fixed, over the regressions fixed. */
  fixed?: { p50Hours: number; p90Hours: number; regressions: number };
  /** Found and not fixed yet. */
  open: number;
}

export interface RegressionTiming {
  declared: Timing;
  inferred: Timing;
  /** Each regression's cause, kind and times, in the cause's delivery order. Absent once anonymized. */
  perRegression?: { ticket: string; kind: "declared" | "inferred"; foundHours?: number; fixedHours?: number }[];
}

function timing(rows: { found: number | undefined; fixed: number | undefined }[], open: number): Timing {
  const found = rows.flatMap((row) => (row.found === undefined ? [] : [row.found]));
  const fixed = rows.flatMap((row) => (row.fixed === undefined ? [] : [row.fixed]));
  return {
    ...(found.length > 0 && { found: { p50Hours: percentile(found, 50), p90Hours: percentile(found, 90), regressions: found.length } }),
    ...(fixed.length > 0 && { fixed: { p50Hours: percentile(fixed, 50), p90Hours: percentile(fixed, 90), regressions: fixed.length } }),
    open,
  };
}

export const regressionTiming: Metric<RegressionTiming> = {
  id: "regressionTiming",
  name: "Regression timing",

  compute({ tickets, regressions, inferredRegressions }) {
    const byNumber = new Map<number, Ticket>();
    for (const ticket of tickets) {
      for (const pr of ticket.pullRequests) byNumber.set(pr.number, ticket);
      const issue = /^#(\d+)$/.exec(ticket.id)?.[1];
      if (issue) byNumber.set(Number(issue), ticket);
    }
    // Declared: from the cause's delivery to the issue's opening; from opening to closing as completed.
    const declared = regressions.flatMap((bug) => {
      const causes = bug.causedBy.flatMap((number) => byNumber.get(number) ?? []);
      if (causes.length === 0 || bug.createdAt === undefined) return [];
      const last = causes.reduce((a, b) => (b.doneAt > a.doneAt ? b : a));
      const opened = bug.createdAt;
      return [{ ticket: last, found: opened >= last.doneAt ? hoursBetween(last.doneAt, opened) : undefined, fixed: bug.fixed && bug.closedAt ? hoursBetween(opened, bug.closedAt) : undefined, open: !bug.closedAt }];
    });
    // Inferred: from the cause's delivery to the reverting or fixing PR's opening; from its opening to its merge.
    const ours = new Set(tickets);
    const inferred = (inferredRegressions ?? [])
      .filter(({ cause }) => ours.has(cause))
      .map(({ cause, by }) => ({ ticket: cause, found: by.createdAt >= cause.doneAt ? hoursBetween(cause.doneAt, by.createdAt) : undefined, fixed: hoursBetween(by.createdAt, by.mergedAt), open: false }));
    const order = new Map(tickets.map((ticket, index) => [ticket, index]));
    const row = (kind: "declared" | "inferred") => (entry: (typeof declared)[number]) => ({
      ticket: entry.ticket,
      kind,
      ...(entry.found !== undefined && { foundHours: entry.found }),
      ...(entry.fixed !== undefined && { fixedHours: entry.fixed }),
    });
    const perRegression = [...declared.map(row("declared")), ...inferred.map(row("inferred"))]
      .sort((a, b) => (order.get(a.ticket) ?? 0) - (order.get(b.ticket) ?? 0))
      .map((entry) => ({ ...entry, ticket: entry.ticket.id }));
    const covered = new Set([...regressions.flatMap((bug) => bug.causedBy.flatMap((number) => byNumber.get(number) ?? [])), ...(inferredRegressions ?? []).map(({ cause }) => cause)].filter((ticket) => ours.has(ticket)));
    const coverage = { tickets: covered.size, of: tickets.length };
    if (declared.length + inferred.length === 0) return { value: UNKNOWN, coverage };
    return {
      value: {
        declared: timing(declared, declared.filter((row) => row.open).length),
        inferred: timing(inferred, 0),
        perRegression,
      },
      coverage,
    };
  },

  anonymize: ({ declared, inferred }) => ({ declared, inferred }),

  figure: { label: "found p50", of: ({ declared, inferred }) => (declared.found ?? inferred.found)?.p50Hours ?? Number.NaN, format: formatDuration },

  section({ declared, inferred }) {
    const line = (what: string, t: Timing) => {
      const found = t.found ? `found a median <strong>${formatDuration(t.found.p50Hours)}</strong> after delivery (p90 ${formatDuration(t.found.p90Hours)}, ${plural(t.found.regressions, "regression")})` : "found: unknown";
      const fixed = t.fixed ? `fixed a median <strong>${formatDuration(t.fixed.p50Hours)}</strong> after (p90 ${formatDuration(t.fixed.p90Hours)}, ${plural(t.fixed.regressions, "regression")})` : "fixed: unknown";
      return `<p>${what}: ${found}; ${fixed}${t.open ? `; ${plural(t.open, "regression")} still open` : ""}.</p>`;
    };
    return line("Declared", declared) + line("Inferred", inferred);
  },

  ticketTable: {
    columns: ["Kind", "Found after", "Fixed after"],
    rows: ({ perRegression }) =>
      perRegression?.map((entry) => ({
        id: entry.ticket,
        cells: [
          entry.kind,
          entry.foundHours === undefined ? { text: "unknown", sort: -1 } : { text: formatDuration(entry.foundHours), sort: entry.foundHours },
          entry.fixedHours === undefined ? { text: "not fixed", sort: -1 } : { text: formatDuration(entry.fixedHours), sort: entry.fixedHours },
        ],
      })),
  },

  methodology: {
    definition:
      "For a <strong>declared</strong> regression: <em>found</em> is the time from the delivery of the ticket it names (the latest, when it names several) to its issue's opening; <em>fixed</em>, from its opening to its closing as completed. For an <strong>inferred</strong> one (see Regression rate): found is the time from the cause's delivery to the opening of the PR that reverted or fixed it; fixed, from that PR's opening to its merge. Each as the median (p50) and 90th percentile (p90, nearest rank), the two kinds apart.",
    limits:
      "An issue opened before the ticket it names was delivered (written ahead, or naming the wrong ticket) has no found time. A regression closed as not planned is not fixed. Recent regressions have had less time to be fixed, so the fix time reads low while some are still open.",
  },
};
