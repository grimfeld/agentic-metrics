// Pure decision function for the GitHub Action: an event payload in, a list of
// operations out. It performs no I/O; `main.ts` carries the operations out.
import { DEFAULT_BRANCH_REGEX, issueNumberFromBranch } from "../cli/branch.ts";

export type GitHubEvent = {
  /** `GITHUB_EVENT_NAME`, e.g. `pull_request`. */
  name: string;
  /** The parsed `GITHUB_EVENT_PATH` file. */
  payload: Record<string, unknown>;
};

export type Operation = {
  kind: "update-pr-body";
  owner: string;
  repo: string;
  pullNumber: number;
  body: string;
};

export type Options = {
  /**
   * Finds the issue number in a branch name. The number is the first capture
   * group that matched, or the whole match when the pattern has no groups.
   */
  branchRegex?: RegExp;
};

export { DEFAULT_BRANCH_REGEX };

export const CLOSES_MARKER = "<!-- agentic-metrics:closes -->";

const PR_ACTIONS = new Set(["opened", "edited", "reopened"]);

// Any `#N` (bare or `owner/repo#N`, which covers closing keywords) or a link to an issue or PR.
// `&#38;` is an HTML entity, not a reference.
const ISSUE_REFERENCE = /(?:^|[^&])#\d+\b|github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+/i;

export function decide(event: GitHubEvent, options: Options = {}): Operation[] {
  if (event.name !== "pull_request") return [];
  const payload = event.payload as PullRequestPayload;
  if (!PR_ACTIONS.has(payload.action)) return [];

  const pr = payload.pull_request;
  const repository = payload.repository;
  // A fork's GITHUB_TOKEN is read-only: the edit would fail.
  if (pr.head.repo?.full_name !== repository.full_name) return [];

  const body = pr.body ?? "";
  if (ISSUE_REFERENCE.test(body)) return [];

  const issue = issueNumberFromBranch(pr.head.ref, options.branchRegex ?? DEFAULT_BRANCH_REGEX);
  if (issue === undefined) return [];

  const line = `Closes #${String(issue)} ${CLOSES_MARKER}`;
  const trimmed = body.trimEnd();
  return [
    {
      kind: "update-pr-body",
      owner: repository.owner.login,
      repo: repository.name,
      pullNumber: pr.number,
      body: trimmed === "" ? line : `${trimmed}\n\n${line}`,
    },
  ];
}

type PullRequestPayload = {
  action: string;
  pull_request: {
    number: number;
    body: string | null;
    head: { ref: string; repo: { full_name: string } | null };
  };
  repository: { full_name: string; name: string; owner: { login: string } };
};
