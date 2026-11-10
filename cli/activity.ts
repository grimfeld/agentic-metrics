// A ticket's activity: the timestamped traces of someone, person or agent,
// working on it. Two sources: the authored dates of its own commits, and the
// lines of its Claude Code sessions (sub-agents included). Merge commits are
// not activity: a merge lands work, it is not the work.
//
// Lead time's phases and active time are both read off it (GLOSSARY.md):
//   queue         ready → first activity
//   work          first activity → last activity
//   landing wait  last activity → delivered
//   active time   the work phase with the idle taken out
import { ownCommits, type Ticket } from "./linker.ts";
import { stretches, type Stretch } from "./transcripts/load.ts";

/** A gap between two commits longer than this counts as this much, when commits are all there is. */
export const COMMIT_GAP_CAP_MS = 30 * 60 * 1000;

/** The authored times of a ticket's own non-merge commits, oldest first, each once. */
export function commitTimes(ticket: Ticket): number[] {
  const times = ownCommits(ticket).flatMap((commit) => (commit.parents.length <= 1 && commit.authoredAt ? [commit.authoredAt.getTime()] : []));
  return [...new Set(times)].sort((a, b) => a - b);
}

/** The stretches a ticket's sessions were active in, overlaps merged, oldest first. */
export function sessionStretches(ticket: Ticket): Stretch[] {
  return union(ticket.sessions.flatMap((session) => session.activity));
}

/** `stretches` with every overlap merged, oldest first. */
function union(all: readonly Stretch[]): Stretch[] {
  const merged: Stretch[] = [];
  for (const [from, to] of [...all].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

/** A ticket's lead time split into its phases, in hours. They add up to its lead time. */
export interface Phases {
  queueHours: number;
  workHours: number;
  landingHours: number;
}

const HOUR_MS = 3_600_000;

/**
 * The phases of a ticket's lead time; undefined without a ready moment or any
 * dated activity. Activity is read within the lead time: work that began
 * before the ticket was ready gives a queue of 0, and activity after delivery
 * (a session that went on to something else) is ignored.
 */
export function phasesOf(ticket: Ticket): Phases | undefined {
  if (!ticket.readyAt) return undefined;
  const ready = ticket.readyAt.getTime();
  const done = ticket.doneAt.getTime();
  if (done < ready) return undefined;
  const sessions = sessionStretches(ticket);
  const commits = commitTimes(ticket);
  const starts = [...commits, ...sessions.map(([from]) => from)].filter((time) => time <= done);
  if (starts.length === 0) return undefined;
  const ends = [...commits.filter((time) => time <= done), ...sessions.filter(([from]) => from <= done).map(([, to]) => Math.min(to, done))];
  const first = Math.min(Math.max(Math.min(...starts), ready), done);
  const last = Math.max(Math.max(...ends), first);
  return { queueHours: (first - ready) / HOUR_MS, workHours: (last - first) / HOUR_MS, landingHours: (done - last) / HOUR_MS };
}

export type ActiveTimeKind = "measured" | "estimated";

/**
 * A ticket's active time in hours, and how it is known. Measured, for a
 * ticket with sessions: the time they were active, a stretch several ran in
 * counted once. Estimated, for a ticket with commits only: the gaps between
 * its consecutive commits, each capped at COMMIT_GAP_CAP_MS, with nothing
 * credited before the first. Undefined when neither says anything: no session
 * and fewer than two commit times, or no time between them.
 */
export function activeTimeOf(ticket: Ticket): { hours: number; kind: ActiveTimeKind } | undefined {
  const kind: ActiveTimeKind = ticket.sessions.length > 0 ? "measured" : "estimated";
  const active = kind === "measured" ? sessionStretches(ticket) : stretches(commitTimes(ticket), COMMIT_GAP_CAP_MS);
  const ms = active.reduce((sum, [from, to]) => sum + (to - from), 0);
  return ms > 0 ? { hours: ms / HOUR_MS, kind } : undefined;
}
