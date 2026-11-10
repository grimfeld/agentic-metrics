// Links merged PRs to tickets. A ticket is a GitHub issue, gathering every PR
// linked to it; a PR linked to no issue of this repo is a ticket of its own.
//
// A PR is linked by the first of these that names an issue:
//   1. its closing references (`Closes #N`, manual links);
//   2. the issue number in its branch name, through the config's branch regex;
//   3. `(#N)` in its commit subjects;
// else it is a ticket of its own. Strategies 2 and 3 only link to issues
// GitHub returned, so a number that is a PR, or no issue at all, falls through.
//
// Integration (batch) PRs, recognised by the config's branch prefixes, are kept
// apart: never a ticket or a ticket PR themselves. They deliver the ticket PRs
// merged into their branch, and the issues they close that no ticket PR
// delivered (work merged into the batch without a PR of its own).
//
// A ticket delivered only by integration PRs takes the commits of theirs that
// name it (`batch.ts`) as its own; a ticket with a PR of its own keeps that
// PR's commits only, so no commit counts twice.
//
// Work counts once it reaches the default branch: a ticket PR when it merges
// into it, or when the integration PR of the branch it merged into does.
import type { Autonomy } from "./autonomy.ts";
import { attributeBatch } from "./batch.ts";
import type { Config } from "./config.ts";
import { mainWorkflow, type Ci } from "./ci.ts";
import { issueNumberFromBranch } from "./branch.ts";
import type { Commit, GitHubData, Issue, PullRequest, RegressionIssue } from "./github/load.ts";
import type { Session } from "./transcripts/load.ts";

export interface Ticket {
  /** `#104` for an issue, `PR #136` for a PR that is its own ticket. */
  id: string;
  /** The issue, or undefined for a PR that is its own ticket or an issue GitHub did not return. */
  issue: Issue | undefined;
  /** Its delivered ticket PRs. Empty only when an integration PR alone delivered it. */
  pullRequests: PullRequest[];
  /** Integration PRs that close its issue. */
  integrationPullRequests: PullRequest[];
  /** Commits of those integration PRs credited to it (`batch.ts`). Read through `ownCommits`. */
  batchCommits: Commit[];
  /**
   * When it became ready: the ready label, else the issue's creation; for a PR
   * that is its own ticket, the earlier of its opening and its first commit.
   * Undefined when unknown.
   */
  readyAt: Date | undefined;
  /** When its last PR reached the default branch. */
  doneAt: Date;
  /** Its Claude Code sessions, sub-agents included (`transcripts/link.ts`). None: its transcript metrics are unknown. */
  sessions: Session[];
  /** Its autonomy level, set once sessions are linked (`autonomy.ts`); undefined before. */
  autonomy?: Autonomy;
}

export interface LinkedWork {
  tickets: Ticket[];
  /** Ticket PRs delivered to the default branch: no integration PR, nothing excluded. */
  pullRequests: PullRequest[];
  /** Integration PRs merged into the default branch, nothing excluded. Kept for batch metrics. */
  integrationPullRequests: PullRequest[];
  /** Issues labelled as regressions, whether or not their cause is delivered work. */
  regressions: RegressionIssue[];
  /** CI runs, and the repo's main check workflow. */
  ci: Ci;
  /** The repo's Claude Code transcripts (`transcripts/link.ts`). */
  transcripts: {
    /** Sessions read, sub-agents included. None: no transcript was read and transcript metrics are unknown. */
    sessions: number;
    /** Sessions naming no work: repo-level orchestration (grilling, planning, batching). */
    orchestration: Session[];
  };
}

export function link(data: GitHubData, config: Config): LinkedWork {
  const { defaultBranch } = data.repo;
  const counted = data.pullRequests.filter((pr) => !excluded(pr, config));
  const isIntegration = (pr: PullRequest) => config.integrationBranchPrefixes.some((prefix) => pr.headRefName.startsWith(prefix));
  const integrationPullRequests = counted.filter((pr) => isIntegration(pr) && pr.baseRefName === defaultBranch);

  // When each delivered ticket PR reached the default branch.
  const deliveredAt = new Map<PullRequest, Date>();
  for (const pr of counted) {
    if (isIntegration(pr)) continue;
    if (pr.baseRefName === defaultBranch) {
      deliveredAt.set(pr, pr.mergedAt);
      continue;
    }
    const landing = integrationPullRequests
      .filter((batch) => batch.headRefName === pr.baseRefName && batch.mergedAt >= pr.mergedAt)
      .sort((a, b) => a.mergedAt.getTime() - b.mergedAt.getTime())[0];
    if (landing) deliveredAt.set(pr, landing.mergedAt);
  }
  const pullRequests = [...deliveredAt.keys()];
  const issues = new Map(data.issues.map((issue) => [issue.number, issue]));

  const issuePrs = new Map<number, PullRequest[]>();
  const tickets: Ticket[] = [];
  for (const pr of pullRequests) {
    const linked = linkedIssues(pr, issues, config);
    if (linked.length === 0) {
      const doneAt = deliveredAt.get(pr) ?? pr.mergedAt;
      tickets.push({ id: `PR #${String(pr.number)}`, issue: undefined, pullRequests: [pr], integrationPullRequests: [], batchCommits: [], readyAt: prStart(pr), doneAt, sessions: [] });
    }
    for (const number of linked) issuePrs.set(number, [...(issuePrs.get(number) ?? []), pr]);
  }

  const issueBatches = new Map<number, PullRequest[]>();
  const issueBatchCommits = new Map<number, Commit[]>();
  for (const batch of integrationPullRequests) {
    for (const number of batch.closes) issueBatches.set(number, [...(issueBatches.get(number) ?? []), batch]);
    for (const [number, commits] of attributeBatch(batch, config)) {
      issueBatchCommits.set(number, [...(issueBatchCommits.get(number) ?? []), ...commits]);
    }
  }

  for (const number of new Set([...issuePrs.keys(), ...issueBatches.keys()])) {
    const issue = issues.get(number);
    const prs = issuePrs.get(number) ?? [];
    const batches = issueBatches.get(number) ?? [];
    const times = [...prs.map((pr) => deliveredAt.get(pr) ?? pr.mergedAt), ...batches.map((batch) => batch.mergedAt)];
    const doneAt = new Date(Math.max(...times.map((time) => time.getTime())));
    tickets.push({
      id: `#${String(number)}`,
      issue,
      pullRequests: prs,
      integrationPullRequests: batches,
      batchCommits: issueBatchCommits.get(number) ?? [],
      readyAt: issue && readyAt(issue, doneAt, config),
      doneAt,
      sessions: [],
    });
  }

  tickets.sort((a, b) => a.doneAt.getTime() - b.doneAt.getTime());
  const ci: Ci = {
    defaultBranch,
    mainWorkflow: mainWorkflow(data.workflowRuns, [...pullRequests, ...integrationPullRequests], config.ciWorkflow),
    runs: data.workflowRuns,
  };
  return {
    tickets,
    pullRequests,
    integrationPullRequests,
    regressions: data.regressions,
    ci,
    transcripts: { sessions: 0, orchestration: [] },
  };
}

/**
 * The commits that are a ticket's own work: those of its PRs, else, for a
 * ticket only integration PRs delivered, the commits of theirs credited to it.
 */
export function ownCommits(ticket: Ticket): Commit[] {
  return ticket.pullRequests.length > 0 ? ticket.pullRequests.flatMap((pr) => pr.commits) : ticket.batchCommits;
}

/**
 * The non-merge commits credited to a ticket only integration PRs delivered:
 * its diff, since a merge's own diff repeats what it merged. Empty for a
 * ticket with a PR of its own, whose diff is its PRs'.
 */
export function batchDiffCommits(ticket: Ticket): Commit[] {
  return ticket.pullRequests.length > 0 ? [] : ticket.batchCommits.filter((commit) => commit.parents.length <= 1);
}

/** Whether a ticket has a diff of its own: a PR, or commits credited from a batch. */
export function hasOwnDiff(ticket: Ticket): boolean {
  return ticket.pullRequests.length > 0 || batchDiffCommits(ticket).length > 0;
}

/** By author login (case-insensitive, with or without a bot's `[bot]` suffix) or by branch prefix. */
function excluded(pr: PullRequest, config: Config): boolean {
  const login = (name: string) => name.toLowerCase().replace(/\[bot\]$/, "");
  const author = pr.author === undefined ? undefined : login(pr.author);
  return (
    config.exclude.authors.some((name) => login(name) === author) ||
    config.exclude.branches.some((prefix) => pr.headRefName.startsWith(prefix))
  );
}

/** The issues a PR delivers, by the first strategy that finds any. */
function linkedIssues(pr: PullRequest, issues: Map<number, Issue>, config: Config): number[] {
  if (pr.closes.length > 0) return pr.closes;
  const fromBranch = issueNumberFromBranch(pr.headRefName, config.branchRegex);
  if (fromBranch !== undefined && issues.has(fromBranch)) return [fromBranch];
  const fromCommits = pr.commitSubjects.flatMap((subject) =>
    [...subject.matchAll(COMMIT_REFERENCE)].map((match) => Number(match[1])),
  );
  return [...new Set(fromCommits)].filter((number) => issues.has(number));
}

// `(#364)` in a commit subject, as squash merges and Lifeline's commits write it.
const COMMIT_REFERENCE = /\(#(\d+)\)/g;

/**
 * When the work of a PR that is its own ticket started, as far as GitHub
 * shows: the earlier of its opening and its first commit. A PR opened only to
 * merge it (Lifeline's Claude Code cloud sessions open and merge within a
 * minute) would otherwise start at its end. Unknown when that start is no
 * earlier than its last commit (one commit, opened after it): a lone commit is
 * written once the work is done, so nothing dates its start. With no commit
 * dates from GitHub, its opening.
 */
function prStart(pr: PullRequest): Date | undefined {
  const times = pr.commits.flatMap((commit) => (commit.authoredAt ? [commit.authoredAt.getTime()] : []));
  if (times.length === 0) return pr.createdAt;
  const start = Math.min(pr.createdAt.getTime(), ...times);
  return start < Math.max(...times) ? new Date(start) : undefined;
}

/** The first time the ready label was added before the work was done, else the issue's creation. */
function readyAt(issue: Issue, doneAt: Date, config: Config): Date {
  const labelled = issue.labelled.find((event) => event.label === config.readyLabel && event.at <= doneAt);
  return labelled?.at ?? issue.createdAt;
}
