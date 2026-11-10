import { verdict } from "../ci.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { formatPercent, percent } from "./stats.ts";

export interface ScheduledFailures {
  /** Scheduled runs on the default branch that failed on their first attempt. */
  failed: number;
  /** Scheduled runs on the default branch that gave a result. */
  runs: number;
  /** The same per workflow, by path. Absent once anonymized: a workflow's name can name the repo or client. */
  workflows?: { workflow: string; failed: number; runs: number }[];
}

export const scheduledFailures: Metric<ScheduledFailures> = {
  id: "scheduledFailures",
  name: "Scheduled CI failures",

  // Repo level: breakage tied to no ticket, so it covers every ticket's period.
  compute({ tickets, ci }) {
    const coverage = { tickets: tickets.length, of: tickets.length };
    const workflows = new Map<string, { workflow: string; failed: number; runs: number }>();
    for (const run of ci.runs) {
      if (run.event !== "schedule" || run.headBranch !== ci.defaultBranch) continue;
      const result = verdict(run.firstAttemptConclusion);
      if (!result) continue;
      const row = workflows.get(run.path) ?? { workflow: run.path, failed: 0, runs: 0 };
      row.runs++;
      if (result === "failed") row.failed++;
      workflows.set(run.path, row);
    }
    const rows = [...workflows.values()].sort((a, b) => (a.workflow < b.workflow ? -1 : 1));
    if (rows.length === 0) return { value: UNKNOWN, coverage };
    const sum = (key: "failed" | "runs") => rows.reduce((total, row) => total + row[key], 0);
    return { value: { failed: sum("failed"), runs: sum("runs"), workflows: rows }, coverage };
  },

  anonymize: ({ failed, runs }) => ({ failed, runs }),

  // Repo level: no ticket owns a scheduled run.
  figure: { label: "of runs failed", of: ({ failed, runs }) => percent(failed / runs), format: formatPercent, byAutonomy: false },

  sentence: ({ failed, runs }) => `${String(failed)} of ${String(runs)} scheduled CI runs on the default branch failed`,

  section: ({ failed, runs }) => `<p><strong>${String(failed)}</strong> of ${String(runs)} scheduled runs on the default branch failed.</p>`,

  ticketTable: {
    rowHeading: "Workflow",
    columns: ["Failed", "Runs", "Failure rate"],
    rows: ({ workflows }) =>
      workflows?.map((row) => {
        const rate = percent(row.failed / row.runs);
        return {
          id: row.workflow,
          cells: [
            { text: String(row.failed), sort: row.failed },
            { text: String(row.runs), sort: row.runs },
            { text: formatPercent(rate), sort: rate },
          ],
        };
      }),
  },

  methodology: {
    definition:
      "Scheduled CI runs (<code>schedule</code> event) on the default branch that failed, out of those that gave a result, counted at repo level: this breakage is tied to no ticket. A run is judged on its first attempt, so a nightly run that passed only on a re-run still counts as a failure. Failed means <code>failure</code>, <code>timed_out</code> or <code>startup_failure</code>; cancelled and skipped runs are left out.",
    limits:
      "Counts runs, not distinct breakages: a nightly job red for a week counts seven times. GitHub's own scheduled runs (CodeQL's <code>dynamic</code> runs) are left out. Coverage is every ticket, since the count is not per ticket. Unknown when the repo has no scheduled run.",
  },
};
