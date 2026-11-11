// CI duration: how long the main check workflow ran on each PR, first attempt
// of each run (a re-run's time is not added to it).
import { pullRequestRuns } from "../ci.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { percentile, plural, round, sum } from "./stats.ts";

export interface CiDuration {
  /** Minutes per run of the main check workflow, first attempts only. */
  p50Minutes: number;
  p90Minutes: number;
  runs: number;
  /** Minutes in all, over those runs. */
  totalMinutes: number;
  /** Per PR with a timed run, by number. Absent once anonymized. */
  perPullRequest?: { pullRequest: number; runs: number; minutes: number }[];
}

const formatMinutes = (minutes: number) => (minutes < 60 ? `${String(round(minutes, 1))} min` : `${String(round(minutes / 60, 1))} h`);

export const ciDuration: Metric<CiDuration> = {
  id: "ciDuration",
  name: "CI duration",

  compute({ tickets, ci }) {
    const perPullRequest = tickets
      .flatMap((ticket) => ticket.pullRequests)
      .flatMap((pr) => {
        const minutes = pullRequestRuns(pr, ci)
          .filter((run) => run.path === ci.mainWorkflow && run.firstAttemptMs !== undefined)
          .map((run) => (run.firstAttemptMs ?? 0) / 60_000);
        return minutes.length ? [{ pullRequest: pr.number, minutes }] : [];
      });
    const timed = new Set(perPullRequest.map((row) => row.pullRequest));
    const coverage = { tickets: tickets.filter((ticket) => ticket.pullRequests.some((pr) => timed.has(pr.number))).length, of: tickets.length };
    const all = perPullRequest.flatMap((row) => row.minutes);
    if (all.length === 0) return { value: UNKNOWN, coverage };
    return {
      value: {
        p50Minutes: round(percentile(all, 50), 1),
        p90Minutes: round(percentile(all, 90), 1),
        runs: all.length,
        totalMinutes: round(sum(all), 1),
        perPullRequest: [...new Map(perPullRequest.map((row) => [row.pullRequest, row])).values()]
          .map((row) => ({ pullRequest: row.pullRequest, runs: row.minutes.length, minutes: round(sum(row.minutes), 1) }))
          .sort((a, b) => a.pullRequest - b.pullRequest),
      },
      coverage,
    };
  },

  anonymize: ({ p50Minutes, p90Minutes, runs, totalMinutes }) => ({ p50Minutes, p90Minutes, runs, totalMinutes }),

  figure: { label: "p50 per run", of: ({ p50Minutes }) => p50Minutes, format: formatMinutes },

  section({ p50Minutes, p90Minutes, runs, totalMinutes }) {
    return `<p>A run of the main check took a median <strong>${formatMinutes(p50Minutes)}</strong> (p90 ${formatMinutes(p90Minutes)}), over ${plural(runs, "run")}: ${formatMinutes(totalMinutes)} in all.</p>`;
  },

  ticketTable: {
    rowHeading: "PR",
    columns: ["Runs", "CI time"],
    rows: ({ perPullRequest }) =>
      perPullRequest?.map((row) => ({
        id: `PR #${String(row.pullRequest)}`,
        cells: [
          { text: String(row.runs), sort: row.runs },
          { text: formatMinutes(row.minutes), sort: row.minutes },
        ],
      })),
  },

  sentence: ({ p50Minutes, runs }) => `CI ran a median ${formatMinutes(p50Minutes)} per pull request run (${plural(runs, "run")})`,

  methodology: {
    definition:
      "How long each <code>pull_request</code> run of the main check workflow (as for the first-run CI rate) on a delivered PR ran: its first attempt, from its start to its last update. A re-run is judged on its first attempt, so its later attempts' time is not added. The figures are the median (p50) and 90th percentile (p90, nearest rank) per run, and the total.",
    limits:
      "A run's last update is when it finished for a completed run, but can be later when GitHub updates it afterwards. Time queued before a run starts is not counted. Runs still in progress, and runs recorded before their times were read, are left out.",
  },
};
