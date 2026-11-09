// Gives each ticket an autonomy level, from its human messages (transcripts)
// and the Claude trailers of its commits (GitHub):
//   `full`: it has a transcript, at most `fullMaxFollowUps` human messages
//      beyond the opening request, and at least `fullMinClaudeCommitShare` of
//      its commits co-authored by Claude (by default: every one);
//   `manual`: no transcript and no commit co-authored by Claude;
//   `assisted`: anything between.
// A commit made in a Claude Code cloud session (`Claude-Session:` trailer)
// counts as co-authored by Claude. A ticket delivered only through integration
// PRs is judged on the commits of theirs credited to it (`ownCommits`).
// Without a transcript the human messages are unknown, so a ticket is never
// `full` on its commits alone.
//
// An `autonomy:full`, `autonomy:assisted` or `autonomy:manual` label on the
// ticket's issue, else on one of its PRs, wins over the computed level.
import type { AutonomyThresholds } from "./config.ts";
import { ownCommits, type LinkedWork, type Ticket } from "./linker.ts";

export const AUTONOMY_LEVELS = ["full", "assisted", "manual"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export interface Autonomy {
  /** The level the ticket counts under: its label's, else the computed one. */
  level: AutonomyLevel;
  /** The level the rule gives, whatever the label says. */
  computed: AutonomyLevel;
  /** An `autonomy:*` label set the level by hand. */
  overridden: boolean;
}

export function classifyAutonomy(work: LinkedWork, thresholds: AutonomyThresholds): LinkedWork {
  return {
    ...work,
    tickets: work.tickets.map((ticket) => {
      const computed = computedLevel(ticket, thresholds);
      const label = labelledLevel(ticket);
      return { ...ticket, autonomy: { level: label ?? computed, computed, overridden: label !== undefined } };
    }),
  };
}

function computedLevel(ticket: Ticket, thresholds: AutonomyThresholds): AutonomyLevel {
  const commits = ownCommits(ticket);
  const claude = commits.filter((commit) => commit.claudeCoAuthor || commit.cloudSession).length;
  const transcript = ticket.sessions.length > 0;
  if (!transcript && claude === 0) return "manual";
  if (!transcript || commits.length === 0) return "assisted";
  const humanMessages = new Set(ticket.sessions.flatMap((session) => session.humanMessages)).size;
  const full = humanMessages <= 1 + thresholds.fullMaxFollowUps && claude / commits.length >= thresholds.fullMinClaudeCommitShare;
  return full ? "full" : "assisted";
}

const LABEL = /^autonomy:(full|assisted|manual)$/i;

function labelledLevel(ticket: Ticket): AutonomyLevel | undefined {
  const labels = [...(ticket.issue?.labels ?? []), ...ticket.pullRequests.flatMap((pr) => pr.labels)];
  for (const label of labels) {
    const level = LABEL.exec(label.trim())?.[1];
    if (level !== undefined) return level.toLowerCase() as AutonomyLevel;
  }
  return undefined;
}
