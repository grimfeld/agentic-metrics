import { AUTONOMY_LEVELS, type AutonomyLevel } from "../autonomy.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { formatPercent, percent } from "./stats.ts";

export interface AutonomyCounts {
  /** Tickets at each level, overrides applied. */
  full: number;
  assisted: number;
  manual: number;
  /** Tickets whose level an `autonomy:*` label set by hand. */
  overridden: number;
  /** Each ticket's level, in delivery order. Absent once anonymized. */
  perTicket?: { ticket: string; level: AutonomyLevel; computed: AutonomyLevel; overridden: boolean }[];
}

const NAMES: Record<AutonomyLevel, string> = { full: "Full", assisted: "Assisted", manual: "Manual" };

export const autonomy: Metric<AutonomyCounts> = {
  id: "autonomy",
  name: "Autonomy level",

  compute({ tickets }) {
    const perTicket = tickets.flatMap((ticket) =>
      ticket.autonomy ? [{ ticket: ticket.id, ...ticket.autonomy }] : [],
    );
    const coverage = { tickets: perTicket.length, of: tickets.length };
    if (perTicket.length === 0) return { value: UNKNOWN, coverage };
    const count = (level: AutonomyLevel) => perTicket.filter((row) => row.level === level).length;
    return {
      value: {
        full: count("full"),
        assisted: count("assisted"),
        manual: count("manual"),
        overridden: perTicket.filter((row) => row.overridden).length,
        perTicket,
      },
      coverage,
    };
  },

  anonymize: ({ full, assisted, manual, overridden }) => ({ full, assisted, manual, overridden }),

  // The share delivered at full autonomy. The comparison is by these levels, so it has none of its own.
  figure: {
    label: "full",
    of: ({ full, assisted, manual }) => percent(full / (full + assisted + manual)),
    format: formatPercent,
    byAutonomy: false,
  },

  sentence: ({ full, assisted, manual }) =>
    `${String(full)} of ${String(full + assisted + manual)} tickets delivered at full autonomy: at most one follow-up message, every commit co-authored by Claude`,

  section(value) {
    const total = value.full + value.assisted + value.manual;
    const counts = AUTONOMY_LEVELS.map((level) => `<tr><th>${NAMES[level]}</th><td>${String(value[level])}</td></tr>`).join("");
    const overridden = `<p>${String(value.overridden)} of ${String(total)} tickets overridden by an <code>autonomy:*</code> label.</p>`;
    if (!value.perTicket) return `<table><tbody>${counts}</tbody></table>${overridden}`;
    const rows = value.perTicket
      .map((row) => `<tr><td>${row.ticket}</td><td>${NAMES[row.level]}</td><td>${row.overridden ? `by label (computed: ${NAMES[row.computed]})` : "computed"}</td></tr>`)
      .join("");
    return `<table><tbody>${counts}</tbody></table>${overridden}<table><thead><tr><th>Ticket</th><th>Level</th><th>Set</th></tr></thead><tbody>${rows}</tbody></table>`;
  },

  methodology: {
    definition:
      "Each ticket is <em>full</em>, <em>assisted</em> or <em>manual</em>. <em>Full</em>: it has Claude Code transcripts with at most one human message beyond the opening request, and every commit of its PRs is co-authored by Claude. A ticket with no PR of its own, delivered only through an integration (batch) PR, is judged on the commits of that PR credited to it: a commit whose subject names one of the issues the batch closes, as a merge of a branch the per-repo branch pattern resolves (<code>Merge ticket-N: …</code>, <code>Merge branch 'ticket-N'</code>, <code>Merge pull request #M from owner/ticket-N</code>; a branch under an integration prefix never names a ticket), else by <code>(#N)</code> in its subject; and the commits such a merge brought in, those reachable from its merged side but not from the batch line. A commit naming a ticket itself keeps it. Commits credited to a ticket with a PR of its own are ignored, so no commit counts twice; commits naming no ticket count for none. <em>Manual</em>: no transcript and no commit co-authored by Claude. <em>Assisted</em>: anything between (more human messages, some commits by a person alone, or Claude's commits without a transcript). A commit is co-authored by Claude when a <code>Co-Authored-By:</code> trailer names Claude (a name starting with \"Claude\" or an anthropic.com address), or when a <code>Claude-Session:</code> trailer shows it was made in a cloud session. Human messages are counted as for human messages per ticket. Both thresholds (follow-up messages allowed, share of commits co-authored) are set per repo in <code>.agentic-metrics.json</code> under <code>autonomy</code> (<code>fullMaxFollowUps</code>, default 1; <code>fullMinClaudeCommitShare</code>, default 1). An <code>autonomy:full</code>, <code>autonomy:assisted</code> or <code>autonomy:manual</code> label on the ticket's issue, else on one of its PRs, wins over the computed level; the count of tickets so overridden is given, whether or not the label changed the level.",
    limits:
      "The rule reads traces, not intent: Claude can co-author a commit a person mostly wrote, and a person can commit Claude's work without the trailer. Cloud sessions and work outside Claude Code leave no local transcript, so their human messages are unknown and such a ticket is at best <em>assisted</em> unless labelled; a ticket steered from an orchestrating session on the default branch shows fewer messages than the person wrote about it. Only the first 100 commits of each PR are read: in a larger integration PR, later commits are credited to no ticket, and a merge whose merged commits fall past the 100th brings in only those read. A batch commit is credited only when its subject names its ticket or a credited merge brought it in: work committed straight onto the integration branch without <code>(#N)</code>, or merged under a branch name the pattern does not resolve, counts for no ticket, and a ticket left with no credited commit is never <em>full</em>. A subject naming the wrong issue credits the wrong ticket.",
  },
};
