// Links merged PRs to tickets. A ticket is a GitHub issue, gathering every PR
// that closes it; a PR that closes no issue of this repo is a ticket of its own.
// Only PRs merged into the default branch deliver work, so only they count.
import type { Config } from "./config.ts";
import type { GitHubData, Issue, PullRequest, RegressionIssue } from "./github/load.ts";

export interface Ticket {
  /** `#104` for an issue, `PR #136` for a PR that is its own ticket. */
  id: string;
  /** The issue, or undefined for a PR that is its own ticket or an issue GitHub did not return. */
  issue: Issue | undefined;
  /** Its PRs merged into the default branch, at least one. */
  pullRequests: PullRequest[];
  /** When it became ready: the ready label, else creation. Undefined when unknown. */
  readyAt: Date | undefined;
  /** When its last PR merged into the default branch. */
  doneAt: Date;
}

export interface LinkedWork {
  tickets: Ticket[];
  /** PRs merged into the default branch. */
  pullRequests: PullRequest[];
  /** Issues labelled as regressions, whether or not their cause is delivered work. */
  regressions: RegressionIssue[];
}

export function link(data: GitHubData, config: Config): LinkedWork {
  const pullRequests = data.pullRequests.filter((pr) => pr.baseRefName === data.repo.defaultBranch);
  const issues = new Map(data.issues.map((issue) => [issue.number, issue]));

  const issuePrs = new Map<number, PullRequest[]>();
  const tickets: Ticket[] = [];
  for (const pr of pullRequests) {
    if (pr.closes.length === 0) {
      tickets.push({ id: `PR #${String(pr.number)}`, issue: undefined, pullRequests: [pr], readyAt: pr.createdAt, doneAt: pr.mergedAt });
    }
    for (const number of pr.closes) issuePrs.set(number, [...(issuePrs.get(number) ?? []), pr]);
  }

  for (const [number, prs] of issuePrs) {
    const issue = issues.get(number);
    const doneAt = new Date(Math.max(...prs.map((pr) => pr.mergedAt.getTime())));
    tickets.push({ id: `#${String(number)}`, issue, pullRequests: prs, readyAt: issue && readyAt(issue, doneAt, config), doneAt });
  }

  tickets.sort((a, b) => a.doneAt.getTime() - b.doneAt.getTime());
  return { tickets, pullRequests, regressions: data.regressions };
}

/** The first time the ready label was added before the work was done, else the issue's creation. */
function readyAt(issue: Issue, doneAt: Date, config: Config): Date {
  const labelled = issue.labelled.find((event) => event.label === config.readyLabel && event.at <= doneAt);
  return labelled?.at ?? issue.createdAt;
}
