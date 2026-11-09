// Credits an integration (batch) PR's commits to the tickets it delivers. A
// ticket delivered only through a batch has no PR of its own; these commits
// are what autonomy and the commit-reading metrics see of it.
//
// A commit of the batch belongs to an issue the batch closes when its subject
// names it:
//   1. a merge whose merged branch the config's branch regex resolves:
//      `Merge ticket-N: …` (the merge step's own subject), `Merge branch 'X'`,
//      `Merge pull request #M from owner/X`, `Merge X into Y`. A merged
//      branch under an integration prefix is the batch synced into a ticket
//      branch, never a ticket;
//   2. `(#N)` in its subject.
// A merge so attributed also brings in the commits it merged: those reachable
// from its other parents but not from its first, among the batch's commits
// GitHub returned (the first 100). A commit naming a ticket itself keeps it.
// Commits no rule attributes stay with the batch and count for no ticket.
import { issueNumberFromBranch } from "./branch.ts";
import type { Config } from "./config.ts";
import type { Commit, PullRequest } from "./github/load.ts";

/** The batch's commits per issue it closes, in the batch's order. Issues with none are absent. */
export function attributeBatch(batch: PullRequest, config: Config): Map<number, Commit[]> {
  const delivers = new Set(batch.closes);
  const byOid = new Map(batch.commits.map((commit) => [commit.oid, commit]));
  const owner = new Map<Commit, number>();

  const named = new Map<Commit, number>();
  for (const commit of batch.commits) {
    const number = namedIssue(commit, config);
    if (number !== undefined && delivers.has(number)) named.set(commit, number);
  }
  for (const [commit, number] of named) owner.set(commit, number);

  for (const [merge, number] of named) {
    const [first, ...others] = merge.parents;
    if (first === undefined || others.length === 0) continue;
    const onBatchLine = ancestors([first], byOid);
    for (const commit of ancestors(others, byOid)) {
      if (!onBatchLine.has(commit) && !owner.has(commit)) owner.set(commit, number);
    }
  }

  const attributed = new Map<number, Commit[]>();
  for (const commit of batch.commits) {
    const number = owner.get(commit);
    if (number !== undefined) attributed.set(number, [...(attributed.get(number) ?? []), commit]);
  }
  return attributed;
}

/** The issue a commit's subject names: by merged branch, else by `(#N)`. */
function namedIssue(commit: Commit, config: Config): number | undefined {
  const branch = commit.parents.length > 1 ? mergedBranch(commit.subject) : undefined;
  if (branch !== undefined && !config.integrationBranchPrefixes.some((prefix) => branch.startsWith(prefix))) {
    const number = issueNumberFromBranch(branch, config.branchRegex);
    if (number !== undefined) return number;
  }
  const reference = REFERENCE.exec(commit.subject)?.[1];
  return reference === undefined ? undefined : Number(reference);
}

// `(#364)` in a subject: the last one, as squash merges and the merge step append it.
const REFERENCE = /\(#(\d+)\)(?!.*\(#\d+\))/;

const MERGED_BRANCH = [
  /^Merge (?:remote-tracking )?branch '([^']+)'/,
  /^Merge pull request #\d+ from [^/\s]+\/(\S+)/,
  /^Merge (?!branch |pull request )([^\s:']+)(?::|\s+into\s|$)/,
];

/** The branch a merge commit's subject says it merged, without a remote's `origin/`. */
function mergedBranch(subject: string): string | undefined {
  for (const pattern of MERGED_BRANCH) {
    const branch = pattern.exec(subject)?.[1];
    if (branch !== undefined) return branch.replace(/^origin\//, "");
  }
  return undefined;
}

/** `from` and every commit reachable from it through parents GitHub returned. */
function ancestors(from: string[], byOid: Map<string, Commit>): Set<Commit> {
  const seen = new Set<Commit>();
  const stack = [...from];
  for (let oid = stack.pop(); oid !== undefined; oid = stack.pop()) {
    const commit = byOid.get(oid);
    if (!commit || seen.has(commit)) continue;
    seen.add(commit);
    stack.push(...commit.parents);
  }
  return seen;
}
