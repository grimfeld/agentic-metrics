import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { plural } from "./stats.ts";

export interface Throughput {
  /** Every week from the first delivery to the last, empty weeks included. */
  weeks: { week: string; tickets: number; pullRequests: number }[];
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

/** The Monday (UTC) starting the week of `date`, as YYYY-MM-DD. */
function weekOf(date: Date): string {
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

export const throughput: Metric<Throughput> = {
  id: "throughput",
  name: "Throughput",

  compute({ tickets, pullRequests }) {
    const coverage = { tickets: tickets.length, of: tickets.length };
    if (tickets.length === 0) return { value: UNKNOWN, coverage };

    const weeks = new Map<string, { week: string; tickets: number; pullRequests: number }>();
    const dates = tickets.map((ticket) => ticket.doneAt).concat(pullRequests.map((pr) => pr.mergedAt));
    const first = Math.min(...dates.map((date) => Date.parse(weekOf(date))));
    const last = Math.max(...dates.map((date) => Date.parse(weekOf(date))));
    for (let time = first; time <= last; time += WEEK_MS) {
      const week = new Date(time).toISOString().slice(0, 10);
      weeks.set(week, { week, tickets: 0, pullRequests: 0 });
    }
    for (const ticket of tickets) {
      const week = weeks.get(weekOf(ticket.doneAt));
      if (week) week.tickets++;
    }
    for (const pr of pullRequests) {
      const week = weeks.get(weekOf(pr.mergedAt));
      if (week) week.pullRequests++;
    }
    return { value: { weeks: [...weeks.values()] }, coverage };
  },

  anonymize: (value) => value,

  figure: {
    label: "tickets",
    of: ({ weeks }) => weeks.reduce((sum, week) => sum + week.tickets, 0),
    format: String,
  },

  sentence({ weeks }) {
    const tickets = weeks.reduce((sum, week) => sum + week.tickets, 0);
    const pullRequests = weeks.reduce((sum, week) => sum + week.pullRequests, 0);
    // A ticket with no PR of its own came through an integration PR: with no PR at all, every one did.
    const how = pullRequests === 0 ? ", all through integration pull requests," : ` in ${plural(pullRequests, "pull request")}`;
    return `Delivered ${plural(tickets, "ticket")}${how} over ${plural(weeks.length, "week")}`;
  },

  section({ weeks }) {
    const rows = weeks
      .map((w) => `<tr><td>${w.week}</td><td>${String(w.tickets)}</td><td>${String(w.pullRequests)}</td></tr>`)
      .join("");
    return `<table><thead><tr><th>Week of</th><th>Tickets</th><th>PRs</th></tr></thead><tbody>${rows}</tbody></table>`;
  },

  methodology: {
    definition:
      "Tickets and pull requests delivered per week. A ticket is a GitHub issue with at least one PR delivered to the default branch; a delivered PR linked to no issue counts as a ticket of its own. A PR is linked by the first of: its closing references (<code>Closes #N</code> and manual links), the issue number in its branch name (per-repo pattern), <code>(#N)</code> in its commit subjects. Integration (batch) PRs, recognised by a per-repo branch prefix, are neither tickets nor counted PRs; they deliver the PRs merged into their branch and the issues they close. PRs from excluded authors or branches count nowhere. A ticket counts in the week its last PR reached the default branch; a PR in the week it merged. Weeks start on Monday (UTC). Every issue a delivered PR closes counts as a ticket: a spec PR that closes a parent issue and its sub-issues counts each of them, the parent included.",
    limits:
      "An issue closed with no merged PR (work pushed straight to the default branch, or closed as done by hand) is not a delivered ticket and is not counted. A branch name or commit subject can name the wrong issue, and only numbers GitHub returns as issues of this repo are linked. A PR merged into an integration branch counts in the week it merged there, not the week the batch landed. PRs merged into any other branch are not counted.",
  },
};
