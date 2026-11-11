// On-demand enrichment (docs/adr/0002): for one ticket, what its conventions
// already say and what tracing found, so that the `enrich` skill can propose
// the missing ones; and, once a person accepts some, writing exactly those to
// GitHub as the ordinary conventions. Nothing the model concludes is stored
// anywhere else: an accepted proposal is a declared fact like any other.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { KINDS, kindOf, type Kind } from "./conventions.ts";
import { isBugFix } from "./inferred-regressions.ts";
import type { GitHubData } from "./github/load.ts";
import type { LinkedWork, Ticket } from "./linker.ts";
import { REGRESSION_LABEL } from "./conventions.ts";

export interface EnrichContext {
  /** `#104` or `PR #136`. */
  ticket: string;
  /** The issue to write conventions on; undefined for a PR that is its own ticket. */
  issue: number | undefined;
  /** Its delivered PRs. */
  pullRequests: number[];
  /** Its current kind of change, from its labels. */
  kind: Kind | "unknown" | "conflicting";
  /** Whether it looks like a bug fix (bug label, `fix:` title, `fix/` branch). */
  bugFix: boolean;
  /** `caused-by:` lines already on its issue. */
  declaredCauses: number[];
  /** What reverts and blame found its fix regressed: the only causes a proposal may name. */
  candidates: { ticket: string; pullRequest: number; how: "revert" | "blame" }[];
  /** Its PRs that close no issue: candidates for a `Closes #N` line. */
  unlinkedPullRequests: number[];
  /** What a proposal may add. */
  kinds: readonly Kind[];
}

/** The ticket `#N` names, as an issue or as one of its PRs. */
function findTicket(work: LinkedWork, number: number): Ticket | undefined {
  return (
    work.tickets.find((ticket) => ticket.issue?.number === number) ??
    work.tickets.find((ticket) => ticket.pullRequests.some((pr) => pr.number === number))
  );
}

export function enrichContext(work: LinkedWork, data: GitHubData, bugLabel: string, number: number): EnrichContext {
  const ticket = findTicket(work, number);
  if (!ticket) throw new Error(`#${String(number)} is no delivered ticket or PR of ${data.repo.fullName}`);
  const issues = new Map(data.issues.map((issue) => [issue.number, issue]));
  const regression = data.regressions.find((bug) => bug.number === ticket.issue?.number);
  const prs = new Set(ticket.pullRequests);
  return {
    ticket: ticket.id,
    issue: ticket.issue?.number,
    pullRequests: ticket.pullRequests.map((pr) => pr.number),
    kind: kindOf(ticket.issue?.labels, ticket.pullRequests.flatMap((pr) => pr.labels)),
    bugFix: ticket.pullRequests.some((pr) => isBugFix(pr, issues, bugLabel)) || (ticket.issue?.labels.includes(bugLabel) ?? false),
    declaredCauses: regression?.causedBy ?? [],
    candidates: (work.inferredRegressions ?? [])
      .filter(({ by, cause }) => prs.has(by) && cause !== ticket)
      .map(({ cause, by, how }) => ({ ticket: cause.id, pullRequest: by.number, how })),
    unlinkedPullRequests: ticket.issue ? [] : ticket.pullRequests.filter((pr) => pr.closes.length === 0).map((pr) => pr.number),
    kinds: KINDS,
  };
}

/** The proposals a person accepted, to write. */
export interface Accepted {
  kind?: Kind | undefined;
  /** The ticket or PR number its regression came from: must be one of the context's candidates. */
  causedBy?: number | undefined;
  /** For an unlinked PR: the issue it delivers. */
  closes?: { pullRequest: number; issue: number } | undefined;
}

/** What `enrich-apply` writes to GitHub with. */
export interface GitHubWriter {
  addLabel(number: number, label: string): Promise<void>;
  comment(issue: number, body: string): Promise<void>;
  appendToPullRequestBody(pullRequest: number, text: string): Promise<void>;
}

/**
 * Writes the accepted proposals for the ticket of `context` as conventions;
 * returns the lines to report. Writes nothing for an empty acceptance, and
 * refuses a cause tracing did not find or a kind outside the six.
 */
export async function applyAccepted(context: EnrichContext, accepted: Accepted, writer: GitHubWriter): Promise<string[]> {
  if (accepted.kind !== undefined && !KINDS.includes(accepted.kind)) throw new Error(`kind must be one of ${KINDS.join(", ")}`);
  const candidates = new Set(context.candidates.flatMap((candidate) => [candidate.ticket, `#${String(candidate.pullRequest)}`]));
  if (accepted.causedBy !== undefined && !candidates.has(`#${String(accepted.causedBy)}`) && !candidates.has(`PR #${String(accepted.causedBy)}`)) {
    throw new Error(`#${String(accepted.causedBy)} is not a cause tracing found for ${context.ticket}`);
  }
  if (accepted.closes && !context.unlinkedPullRequests.includes(accepted.closes.pullRequest)) {
    throw new Error(`PR #${String(accepted.closes.pullRequest)} is not an unlinked PR of ${context.ticket}`);
  }
  const target = context.issue ?? context.pullRequests[0];
  const lines: string[] = [];
  if (accepted.kind !== undefined && target !== undefined) {
    await writer.addLabel(target, `kind:${accepted.kind}`);
    lines.push(`#${String(target)}: labelled kind:${accepted.kind}`);
  }
  if (accepted.causedBy !== undefined) {
    if (context.issue === undefined) throw new Error(`${context.ticket} has no issue to write caused-by on`);
    await writer.comment(context.issue, `caused-by: #${String(accepted.causedBy)}`);
    await writer.addLabel(context.issue, REGRESSION_LABEL);
    lines.push(`#${String(context.issue)}: caused-by: #${String(accepted.causedBy)}, labelled ${REGRESSION_LABEL}`);
  }
  if (accepted.closes) {
    await writer.appendToPullRequestBody(accepted.closes.pullRequest, `Closes #${String(accepted.closes.issue)}`);
    lines.push(`PR #${String(accepted.closes.pullRequest)}: Closes #${String(accepted.closes.issue)}`);
  }
  if (lines.length === 0) lines.push("nothing accepted: nothing written");
  return lines;
}

const run = promisify(execFile);

/** `GitHubWriter` through the `gh` CLI, for the repo `gh` resolves from `cwd`. */
export function ghWriter(cwd: string): GitHubWriter {
  const gh = async (args: string[]) => (await run("gh", args, { cwd })).stdout;
  return {
    // The issues endpoint labels issues and PRs alike.
    async addLabel(number, label) {
      await gh(["api", "-X", "POST", `repos/{owner}/{repo}/issues/${String(number)}/labels`, "-f", `labels[]=${label}`]);
    },
    async comment(issue, body) {
      await gh(["issue", "comment", String(issue), "--body", body]);
    },
    async appendToPullRequestBody(pullRequest, text) {
      const body = (JSON.parse(await gh(["pr", "view", String(pullRequest), "--json", "body"])) as { body: string }).body;
      await gh(["pr", "edit", String(pullRequest), "--body", `${body.trimEnd()}\n\n${text}\n`]);
    },
  };
}
