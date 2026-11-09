// Finding an issue number in a branch name. One definition shared by the CLI's
// linker (default of the config's `branchRegex`) and the GitHub Action (default
// of its `branch-regex` input), so both link a branch to the same issue.

/**
 * Matches `16-title` (GitHub's "create a branch" default) at the start, or a
 * ticket-like prefix followed by the number: `spec-376-…`, `spec/363-…`,
 * `ticket-16`, `fix/issue-12`. A bare number elsewhere (`integration/2026-11-09`)
 * does not match.
 */
export const DEFAULT_BRANCH_REGEX =
  /^(\d+)(?=[-_/]|$)|(?:^|[-_/])(?:issues?|tickets?|spec|gh|fix|bug|feat|feature)[-_/]?(\d+)(?=[-_/]|$)/i;

/** A user-supplied pattern, compiled the way both the CLI and the Action do: case-insensitive. */
export function branchRegex(pattern: string): RegExp {
  return new RegExp(pattern, "i");
}

/**
 * The issue number in `branch`: the first capture group that matched, or the
 * whole match when the pattern has no groups. Undefined when nothing matches
 * or the match is not a positive integer.
 */
export function issueNumberFromBranch(branch: string, regex: RegExp = DEFAULT_BRANCH_REGEX): number | undefined {
  const match = regex.exec(branch);
  if (!match) return undefined;
  // Unmatched groups are undefined at runtime, whatever the array type says.
  const digits = (match.slice(1) as (string | undefined)[]).find((group) => group !== undefined) ?? match[0];
  const issue = Number.parseInt(digits, 10);
  return Number.isSafeInteger(issue) && issue > 0 ? issue : undefined;
}
