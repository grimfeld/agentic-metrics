// Attempts (GLOSSARY.md): the PRs opened to deliver a ticket, merged or
// abandoned. An abandoned pull request is linked to an issue as a merged one
// is (its closing references, else the issue number in its branch, else `(#N)`
// in its commit subjects). On a delivered ticket it is one of its attempts; an
// issue whose PRs were all abandoned is undelivered work, counted apart since
// it is no ticket.
import type { Config } from "./config.ts";
import type { AbandonedPullRequest, GitHubData } from "./github/load.ts";
import { linkedIssues, type LinkedWork } from "./linker.ts";

/** `work` with each ticket's abandoned PRs, and the undelivered issues. */
export function linkAbandoned(work: LinkedWork, data: GitHubData, config: Config): LinkedWork {
  const excluded = (pr: AbandonedPullRequest) => {
    const login = (name: string) => name.toLowerCase().replace(/\[bot\]$/, "");
    return config.exclude.authors.some((name) => login(name) === (pr.author && login(pr.author))) || config.exclude.branches.some((prefix) => pr.headRefName.startsWith(prefix));
  };
  const isIntegration = (pr: AbandonedPullRequest) => config.integrationBranchPrefixes.some((prefix) => pr.headRefName.startsWith(prefix));
  const byIssue = new Map(work.tickets.flatMap((ticket) => (ticket.issue ? [[ticket.issue.number, ticket] as const] : [])));
  const issues = new Map(data.issues.map((issue) => [issue.number, issue]));

  const abandoned = new Map<string, AbandonedPullRequest[]>();
  const undelivered = new Set<number>();
  for (const pr of data.abandonedPullRequests) {
    if (excluded(pr) || isIntegration(pr)) continue;
    for (const number of linkedIssues(pr, issues, config)) {
      const ticket = byIssue.get(number);
      if (ticket) abandoned.set(ticket.id, [...(abandoned.get(ticket.id) ?? []), pr]);
      else if (issues.has(number)) undelivered.add(number);
    }
  }
  return {
    ...work,
    tickets: work.tickets.map((ticket) => ({ ...ticket, abandonedPullRequests: abandoned.get(ticket.id) ?? [] })),
    undelivered: [...undelivered].sort((a, b) => a - b),
  };
}
