// Inferred regressions (GLOSSARY.md): regressions the tool deduces from
// traces, for repos where nobody writes `caused-by: #N`. They are never pooled
// with declared ones: the regression rate shows the two apart.
//
// A revert: a PR delivered to the default branch that reverts the work of an
// earlier one, found by GitHub's revert PR description (`Reverts owner/repo#N`)
// or by a commit's `This reverts commit <sha>.` line naming a commit of an
// earlier PR. The reverted PR's ticket is the cause.
//
// Blame: a bug-fix PR (its issue carries the bug label, its title starts
// `fix:` or `fix(…)`, or its branch starts `fix/`) changed lines some earlier
// PR wrote. `git blame` on the fix's parent, over the lines it modified or
// deleted (added lines are not traced), finds the commits that last touched
// them; the cause is the PR, merged within the window before the fix, that
// owns the most of those lines. It needs a full clone of the repo.
import { execFileSync, spawnSync } from "node:child_process";
import type { Issue, PullRequest } from "./github/load.ts";
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

/** Whether the clone at `dir` can run blame tracing: a git work tree with its full history. */
export function blameReady(dir: string): "ready" | "no-clone" | "shallow" {
  const shallow = spawnSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: dir, encoding: "utf8", timeout: 5000 });
  if (shallow.status !== 0) return "no-clone";
  return shallow.stdout.trim() === "true" ? "shallow" : "ready";
}

/** A PR fixing a bug: its issue carries the bug label, its title starts `fix:`/`fix(…)`, or its branch starts `fix/`. */
export function isBugFix(pr: PullRequest, issues: ReadonlyMap<number, Issue>, bugLabel: string): boolean {
  if (/^fix(?:\(.*?\))?!?:/i.test(pr.title) || /^fix\//i.test(pr.headRefName)) return true;
  return pr.closes.some((number) => issues.get(number)?.labels.includes(bugLabel) ?? false);
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * The regressions blame shows, in the full clone at `dir`: for each bug-fix PR
 * whose merge commit the clone holds, the PR that last touched most of the
 * lines it modified or deleted, merged within `windowDays` before it.
 */
export function blameRegressions(work: LinkedWork, issues: readonly Issue[], options: { dir: string; bugLabel: string; windowDays: number }): InferredRegression[] {
  const git = (args: string[]) => execFileSync("git", args, { cwd: options.dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  const issueMap = new Map(issues.map((issue) => [issue.number, issue]));
  const ticketOfPr = new Map<number, Ticket>();
  for (const ticket of work.tickets) for (const pr of ticket.pullRequests) ticketOfPr.set(pr.number, ticket);
  const prs = [...new Set(work.tickets.flatMap((ticket) => ticket.pullRequests))];
  // A commit on the default branch belongs to the PR that merged it (squash or merge commit) or that it came in with.
  const prOfCommit = new Map<string, PullRequest>();
  for (const pr of prs) {
    for (const commit of pr.commits) if (commit.oid !== "") prOfCommit.set(commit.oid, pr);
    if (pr.mergeCommitOid) prOfCommit.set(pr.mergeCommitOid, pr);
  }

  const found: InferredRegression[] = [];
  for (const fix of prs) {
    if (!fix.mergeCommitOid || !isBugFix(fix, issueMap, options.bugLabel)) continue;
    let diff: string;
    try {
      diff = git(["diff", "--no-color", "--no-ext-diff", "-U0", `${fix.mergeCommitOid}^1`, fix.mergeCommitOid]);
    } catch {
      continue; // The clone does not hold this merge commit.
    }
    const lines = new Map<PullRequest, number>();
    for (const { file, start, count } of oldHunks(diff)) {
      let blame: string;
      try {
        blame = git(["blame", "--porcelain", "-L", `${String(start)},+${String(count)}`, `${fix.mergeCommitOid}^1`, "--", file]);
      } catch {
        continue;
      }
      for (const [, sha = ""] of blame.matchAll(/^([0-9a-f]{40}) \d+ \d+/gm)) {
        const cause = prOfCommit.get(sha);
        if (!cause || cause === fix) continue;
        const age = fix.mergedAt.getTime() - cause.mergedAt.getTime();
        if (age < 0 || age > options.windowDays * DAY_MS) continue;
        lines.set(cause, (lines.get(cause) ?? 0) + 1);
      }
    }
    const [best] = [...lines].sort(([a, x], [b, y]) => y - x || b.mergedAt.getTime() - a.mergedAt.getTime());
    const cause = best && ticketOfPr.get(best[0].number);
    const fixTicket = ticketOfPr.get(fix.number);
    if (cause && cause !== fixTicket) found.push({ cause, how: "blame", by: fix, at: fix.mergedAt });
  }
  return found;
}

/** The old side of each hunk a `-U0` diff changed: lines it modified or deleted. Pure additions have none. */
function oldHunks(diff: string): { file: string; start: number; count: number }[] {
  const hunks: { file: string; start: number; count: number }[] = [];
  let file: string | undefined;
  for (const line of diff.split("\n")) {
    const from = /^--- (?:a\/(.*)|\/dev\/null)$/.exec(line);
    if (from) {
      file = from[1];
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+/.exec(line);
    if (hunk && file !== undefined) {
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      if (count > 0) hunks.push({ file, start: Number(hunk[1]), count });
    }
  }
  return hunks;
}
