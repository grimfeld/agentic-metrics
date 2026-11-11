// Conventions inferred from a repo's history, for the ones its config doesn't
// set: the branch pattern that names a PR's issue, the label that marks an
// issue ready, the label that marks a bug, and whether the repo uses issues at
// all. A repo that never adopted this tool's conventions often has its own.
//
// Inference is deterministic: the same history gives the same values. An
// inferred convention is configuration, not an inferred fact (GLOSSARY.md):
// `collect` uses it in memory, `doctor` shows it, and `init` writes it to the
// config, after which the config's value always wins.
import { branchRegex, DEFAULT_BRANCH_REGEX, issueNumberFromBranch } from "./branch.ts";
import type { Config } from "./config.ts";
import type { GitHubData } from "./github/load.ts";

export interface Inferred {
  /** Set only when a convention other than the default was found. */
  readyLabel?: string;
  /** The pattern's source. */
  branchRegex?: string;
  bugLabel?: string;
  /** False when no delivered PR closes an issue: every PR is its own ticket. */
  usesIssues: boolean;
}

/** How many issues a candidate ready label must have marked, and their share of the issues PRs delivered. */
const MIN_ISSUES = 3;
const MIN_SHARE = 0.5;
/** The share of a branch pattern's matches that may name another issue than the PR's own. */
const MAX_WRONG = 0.1;

/** What the history says about the conventions `config` doesn't set (`configured` names those it does). */
export function inferConventions(data: GitHubData, configured: ReadonlySet<string>): Inferred {
  const delivered = data.pullRequests.filter((pr) => pr.baseRefName === data.repo.defaultBranch);
  const linked = delivered.flatMap((pr) => pr.closes.map((issue) => ({ pr, issue })));
  const inferred: Inferred = { usesIssues: linked.length > 0 };

  if (!configured.has("readyLabel")) {
    const label = readyLabel(data, linked);
    if (label !== undefined) inferred.readyLabel = label;
  }
  if (!configured.has("branchRegex")) {
    const pattern = branchPattern(delivered.filter((pr) => pr.closes.length > 0).map((pr) => ({ branch: pr.headRefName, closes: pr.closes })));
    if (pattern !== undefined) inferred.branchRegex = pattern;
  }
  if (!configured.has("bugLabel")) {
    const label = bugLabel(data);
    if (label !== undefined) inferred.bugLabel = label;
  }
  return inferred;
}

/** `config` with the inferred conventions in place of its defaults. */
export function withInferred(config: Config, inferred: Inferred): Config {
  return {
    ...config,
    ...(inferred.readyLabel !== undefined && { readyLabel: inferred.readyLabel }),
    ...(inferred.branchRegex !== undefined && { branchRegex: branchRegex(inferred.branchRegex) }),
    ...(inferred.bugLabel !== undefined && { bugLabel: inferred.bugLabel }),
  };
}

/**
 * The label most often added to issues before their first PR opened, when it
 * marked at least MIN_ISSUES of them and MIN_SHARE of the issues PRs
 * delivered. None while the default ready label is in use.
 */
function readyLabel(data: GitHubData, linked: { pr: { createdAt: Date }; issue: number }[]): string | undefined {
  const issues = new Map(data.issues.map((issue) => [issue.number, issue]));
  if (data.issues.some((issue) => issue.labelled.some((event) => event.label === "ready-for-agent"))) return undefined;
  const firstPr = new Map<number, number>();
  for (const { pr, issue } of linked) firstPr.set(issue, Math.min(firstPr.get(issue) ?? Infinity, pr.createdAt.getTime()));
  const counts = new Map<string, number>();
  for (const [number, opened] of firstPr) {
    const issue = issues.get(number);
    if (!issue) continue;
    const before = new Set(issue.labelled.filter((event) => event.at.getTime() < opened).map((event) => event.label));
    for (const label of before) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const [best] = [...counts].filter(([label]) => !/bug|defect|regression|^kind:|^autonomy:/i.test(label)).sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  if (!best) return undefined;
  const [label, count] = best;
  return count >= MIN_ISSUES && count >= MIN_SHARE * firstPr.size ? label : undefined;
}

/** `bug` when in use, else the label naming a bug or defect most issues carry. None when `bug` is in use or nothing is. */
function bugLabel(data: GitHubData): string | undefined {
  const counts = new Map<string, number>();
  for (const issue of data.issues) for (const label of issue.labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  if (counts.has("bug")) return undefined;
  const [best] = [...counts].filter(([label]) => /\b(bug|defect)s?\b/i.test(label)).sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  return best?.[0];
}

/**
 * A branch pattern that finds the issue of more PRs than the default does,
 * naming the wrong issue in at most MAX_WRONG of its matches. Candidates: any
 * number standing alone in the branch name, and each prefix the history's
 * branches put before their issue number (`story/42`, `JIRA-42`…).
 */
function branchPattern(branches: { branch: string; closes: number[] }[]): string | undefined {
  if (branches.length === 0) return undefined;
  // Per PR: right when the number found is one of the issues it closes.
  const score = (regex: RegExp) => {
    let right = 0;
    let wrong = 0;
    for (const { branch, closes } of branches) {
      const found = issueNumberFromBranch(branch, regex);
      if (found === undefined) continue;
      if (closes.includes(found)) right++;
      else wrong++;
    }
    return { right, wrong };
  };
  const baseline = score(DEFAULT_BRANCH_REGEX).right;

  const prefixes = new Map<string, number>();
  for (const { branch, closes } of branches) {
    for (const issue of closes) {
      const match = new RegExp(`^(.*?[^0-9])?${String(issue)}(?=[^0-9]|$)`).exec(branch);
      const prefix = match?.[1]?.replace(/^.*\//, "").toLowerCase();
      if (prefix && /^[a-z][a-z0-9]*[-_/#]?$/.test(prefix)) prefixes.set(prefix, (prefixes.get(prefix) ?? 0) + 1);
    }
  }
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const candidates = [
    ...[...prefixes].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).map(([prefix]) => `(?:^|[-_/])${escape(prefix)}(\\d+)(?=[-_/]|$)`),
    "(?:^|[-_/#])(\\d+)(?=[-_/]|$)",
  ];
  let best: { source: string; right: number } | undefined;
  for (const source of candidates) {
    const { right, wrong } = score(branchRegex(source));
    if (wrong > MAX_WRONG * (right + wrong)) continue;
    if (right > baseline && right > (best?.right ?? 0)) best = { source, right };
  }
  return best?.source;
}
