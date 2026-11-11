// Inferred regressions (GLOSSARY.md): regressions the tool deduces from
// traces, for repos where nobody writes `caused-by: #N`. They are never pooled
// with declared ones: the regression rate shows the two apart.
//
// A revert: a PR delivered to the default branch that reverts the work of an
// earlier one, found by GitHub's revert PR description (`Reverts owner/repo#N`)
// or by a commit's `This reverts commit <sha>.` line naming a commit of an
// earlier PR. The reverted PR's ticket is the cause.
import type { PullRequest } from "./github/load.ts";
import type { LinkedWork, Ticket } from "./linker.ts";

export interface InferredRegression {
  /** The ticket that caused it. */
  cause: Ticket;
  /** How it was found. */
  how: "revert" | "blame";
  /** The PR that reverted or fixed it. */
  by: PullRequest;
  /** When that PR merged. */
  at: Date;
}

const REVERT_TITLE = /^revert\b/i;
const REVERTS_PR = /^Reverts (?:[\w.-]+\/[\w.-]+)?#(\d+)\b/m;

/** The regressions reverts show: one per reverted ticket and reverting PR. */
export function revertRegressions(work: LinkedWork): InferredRegression[] {
  const prs = [...new Set([...work.pullRequests, ...work.tickets.flatMap((ticket) => ticket.pullRequests)])];
  const ticketOfPr = new Map<number, Ticket>();
  for (const ticket of work.tickets) for (const pr of ticket.pullRequests) ticketOfPr.set(pr.number, ticket);
  const prOfCommit = new Map<string, PullRequest>();
  for (const pr of prs) for (const commit of pr.commits) if (commit.oid !== "") prOfCommit.set(commit.oid, pr);
  const commitPr = (sha: string) => prOfCommit.get(sha) ?? [...prOfCommit].find(([oid]) => oid.startsWith(sha))?.[1];

  const found: InferredRegression[] = [];
  const seen = new Set<string>();
  for (const by of [...prs].sort((a, b) => a.mergedAt.getTime() - b.mergedAt.getTime())) {
    const reverted = new Set<PullRequest>();
    const named = REVERTS_PR.exec(by.body)?.[1];
    if (named !== undefined) {
      const pr = prs.find((candidate) => candidate.number === Number(named));
      if (pr) reverted.add(pr);
    }
    for (const commit of by.commits) {
      const pr = commit.reverts === undefined ? undefined : commitPr(commit.reverts);
      if (pr) reverted.add(pr);
    }
    for (const pr of reverted) {
      // Reverting a revert restores work: it is no regression of anything.
      if (pr === by || REVERT_TITLE.test(pr.title)) continue;
      const cause = ticketOfPr.get(pr.number);
      if (!cause || pr.mergedAt > by.mergedAt) continue;
      const key = `${cause.id}:${String(by.number)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ cause, how: "revert", by, at: by.mergedAt });
    }
  }
  return found;
}
