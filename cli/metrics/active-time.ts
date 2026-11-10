// Active time: how long a ticket was actually worked on, its idle left out
// (GLOSSARY.md). Two metrics, never mixed in one figure: measured, from the
// ticket's Claude Code sessions; estimated, from its commit times when it has
// no session. A ticket is in one or the other, or in neither.
import { activeTimeOf, COMMIT_GAP_CAP_MS, type ActiveTimeKind } from "../activity.ts";
import { perTicketChart, spanText } from "../report/charts.ts";
import { IDLE_CAP_MS } from "../transcripts/load.ts";
import type { Figure, Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { formatDuration, percentile, plural, round, sum } from "./stats.ts";

export interface ActiveTime {
  p50Hours: number;
  p90Hours: number;
  /** Over every ticket it covers. */
  totalHours: number;
  /** Each ticket's active time, in delivery order, so the percentiles can be traced. Absent once anonymized. */
  tickets?: { ticket: string; hours: number }[];
}

const minutes = (ms: number) => String(ms / 60_000);

interface Kind {
  id: string;
  name: string;
  order: number;
  /** After the figure in the headline card and the CV sentence: how it is known. */
  how: string;
  definition: string;
  limits: string;
}

function activeTimeMetric(kind: ActiveTimeKind, { id, name, order, how, definition, limits }: Kind): Metric<ActiveTime> {
  const figure: Figure<ActiveTime> = { label: "p50", of: ({ p50Hours }) => p50Hours, format: formatDuration };
  const percentiles = ({ p50Hours, p90Hours }: ActiveTime) => `p50 ${formatDuration(p50Hours)}, p90 ${formatDuration(p90Hours)}`;
  return {
    id,
    name,

    compute({ tickets }) {
      const rows = tickets.flatMap((ticket) => {
        const active = activeTimeOf(ticket);
        return active?.kind === kind ? [{ ticket: ticket.id, hours: active.hours }] : [];
      });
      const coverage = { tickets: rows.length, of: tickets.length };
      if (rows.length === 0) return { value: UNKNOWN, coverage };
      const hours = rows.map((row) => row.hours);
      return {
        value: {
          p50Hours: round(percentile(hours, 50), 2),
          p90Hours: round(percentile(hours, 90), 2),
          totalHours: round(sum(hours), 1),
          tickets: rows.map((row) => ({ ...row, hours: round(row.hours, 2) })),
        },
        coverage,
      };
    },

    // Per-ticket rows name tickets: an anonymized dataset keeps the aggregates only.
    anonymize: ({ p50Hours, p90Hours, totalHours }) => ({ p50Hours, p90Hours, totalHours }),

    figure,

    sentence: ({ p50Hours, p90Hours }) => `Median active time of ${formatDuration(p50Hours)} per ticket (p90 ${formatDuration(p90Hours)}), ${how}`,

    // Each ticket's active time; an anonymized dataset has none, so its p50 by month instead.
    chart: {
      title: `${name} per ticket`,
      draw(input) {
        const { p50Hours, p90Hours, tickets } = input.value;
        return perTicketChart(input, figure, {
          what: name,
          rows: tickets?.map((t) => ({ ticket: t.ticket, value: t.hours })),
          head: "Active time",
          markers: [
            { label: "p50", value: p50Hours },
            { label: "p90", value: p90Hours },
          ],
          format: formatDuration,
          description: (rows) => `${name} of each of ${plural(rows.length, "ticket")}, ${spanText(rows, formatDuration)}: ${percentiles(input.value)}.`,
        });
      },
    },

    headline: {
      order,
      card: ({ p50Hours, p90Hours }) => `${formatDuration(p50Hours)} <small>p50</small> · ${formatDuration(p90Hours)} <small>p90</small>`,
      // Percentiles over every repo's tickets: an anonymized repo, with no rows, never pools.
      pool(known) {
        const hours = known.flatMap(({ value }) => (value.tickets ?? []).map((row) => row.hours));
        if (hours.length === 0) return undefined;
        return { p50Hours: round(percentile(hours, 50), 2), p90Hours: round(percentile(hours, 90), 2), totalHours: round(sum(hours), 1) };
      },
    },

    section: ({ p50Hours, p90Hours, totalHours }) =>
      `<p>Half the tickets took up to <strong>${formatDuration(p50Hours)}</strong> of active work, and nine in ten up to <strong>${formatDuration(p90Hours)}</strong>; <strong>${formatDuration(totalHours)}</strong> in all, ${how}.</p>`,

    ticketTable: {
      columns: ["Active time"],
      rows: ({ tickets }) => tickets?.map((t) => ({ id: t.ticket, cells: [{ text: formatDuration(t.hours), sort: t.hours }] })),
    },

    methodology: { definition, limits },
  };
}

export const activeTime = activeTimeMetric("measured", {
  id: "activeTime",
  name: "Active time",
  order: 1,
  how: "measured from its Claude Code sessions",
  definition: `How long a ticket was actually worked on: the time its Claude Code sessions, sub-agents included, were active, as the median (p50) and the 90th percentile (p90, nearest rank) over the tickets that have transcripts or session records. A session is active between two of its consecutive transcript lines, a gap of more than ${minutes(IDLE_CAP_MS)} minutes counting as ${minutes(IDLE_CAP_MS)}: the rest is idle. It is wall-clock time: a stretch in which several of the ticket's sessions or sub-agents ran counts once, not once per agent. Sessions are linked to tickets as for human messages, and a session with no cached transcript is read from its session records: the active time each of its commits added, placed just before that commit. It is the work phase of lead time with its idle taken out, and leaves out the queue and the landing wait altogether.`,
  limits: `Only tickets with a cached transcript or session records are measured: a ticket worked on from another device or in a cloud session, in a repo with no recorder, is not, and is estimated from its commits instead (Active time, estimated). A session record holds totals, not each moment: the time a commit added is placed in the stretch that ends at that commit, so overlaps between sessions are approximate, and what a session did after its last commit is missing. A ticket some of whose sessions were not cached is measured over those that were, so it reads low. Time spent reading or thinking without the session writing anything for over ${minutes(IDLE_CAP_MS)} minutes is not counted, and neither is work done outside Claude Code. A session linked to several tickets counts in full on each. The time of the session that orchestrated the ticket's sub-agents, linked to no ticket, is orchestration time, not this.`,
});

export const estimatedActiveTime = activeTimeMetric("estimated", {
  id: "estimatedActiveTime",
  name: "Active time, estimated",
  order: 1.5,
  how: "estimated from commit times",
  definition: `An estimate of how long a ticket was worked on, for a ticket with no transcript: the time between its consecutive commits (authored dates, merges left out), a gap of more than ${minutes(COMMIT_GAP_CAP_MS)} minutes counting as ${minutes(COMMIT_GAP_CAP_MS)}. Given as the median (p50) and the 90th percentile (p90, nearest rank) over the tickets it covers. A ticket with transcripts is measured instead (Active time) and is not counted here: the two figures cover different tickets and are never pooled together.`,
  limits: `It is an estimate, and a low one. Nothing is credited before the first commit, so the work that led to it is missing, and a long stretch with no commit counts as ${minutes(COMMIT_GAP_CAP_MS)} minutes however long it was worked. A ticket with a single commit, or whose commits all carry the same time, has nothing between commits and is unknown, never 0: on a repo where most tickets are one commit, the estimate covers few of them. Commit dates come from git and can be set by their author; a rebase keeps authored dates, but a squash before the PR was opened leaves one commit.`,
});
