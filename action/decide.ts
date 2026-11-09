// Pure decision function for the GitHub Action: an event payload in, a list of
// operations out. It performs no I/O; `main.ts` carries the operations out.
import { DEFAULT_BRANCH_REGEX, issueNumberFromBranch } from "../cli/branch.ts";
import { causedBy, estimateHours } from "../cli/conventions.ts";

export type GitHubEvent = {
  /** `GITHUB_EVENT_NAME`, e.g. `pull_request` or `issues`. */
  name: string;
  /** The parsed `GITHUB_EVENT_PATH` file. */
  payload: Record<string, unknown>;
  /** For `issues` events: the issue's current comments, which the wrapper fetches. */
  comments?: IssueComment[];
};

export type IssueComment = { body: string | null };

export type Operation =
  | { kind: "update-pr-body"; owner: string; repo: string; pullNumber: number; body: string }
  | { kind: "create-issue-comment"; owner: string; repo: string; issueNumber: number; body: string };

export type Options = {
  /**
   * Finds the issue number in a branch name. The number is the first capture
   * group that matched, or the whole match when the pattern has no groups.
   */
  branchRegex?: RegExp;
  /** The label that marks a bug. Default `bug`. */
  bugLabel?: string;
  /** The label that marks a ticket ready for work. Default `ready-for-agent`. */
  readyLabel?: string;
};

export { DEFAULT_BRANCH_REGEX };

export const DEFAULT_BUG_LABEL = "bug";
export const DEFAULT_READY_LABEL = "ready-for-agent";

export const REGRESSION_MARKER = "<!-- agentic-metrics:regression-question -->";
export const ESTIMATE_MARKER = "<!-- agentic-metrics:estimate-reminder -->";

export const CLOSES_MARKER = "<!-- agentic-metrics:closes -->";

const PR_ACTIONS = new Set(["opened", "edited", "reopened"]);

// Any `#N` (bare or `owner/repo#N`, which covers closing keywords) or a link to an issue or PR.
// `&#38;` is an HTML entity, not a reference.
const ISSUE_REFERENCE = /(?:^|[^&])#\d+\b|github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+/i;

export function decide(event: GitHubEvent, options: Options = {}): Operation[] {
  if (event.name === "pull_request") return decidePullRequest(event.payload as PullRequestPayload, options);
  if (event.name === "issues") return decideIssue(event.payload as IssuesPayload, event.comments ?? [], options);
  return [];
}

function decideIssue(payload: IssuesPayload, comments: IssueComment[], options: Options): Operation[] {
  if (payload.action !== "labeled") return [];
  // Labelling a PR fires `issues` too; reminders are for issues only.
  if (payload.issue.pull_request !== undefined) return [];
  const label = payload.label?.name ?? "";
  if (sameLabel(label, options.bugLabel ?? DEFAULT_BUG_LABEL)) return regressionQuestion(payload, comments);
  if (sameLabel(label, options.readyLabel ?? DEFAULT_READY_LABEL)) return estimateReminder(payload, comments);
  return [];
}

function regressionQuestion(payload: IssuesPayload, comments: IssueComment[]): Operation[] {
  if (alreadyPosted(comments, REGRESSION_MARKER)) return [];
  if (causedBy([payload.issue.body, ...comments.map((c) => c.body)]).length > 0) return [];

  return [
    comment(
      payload,
      `Regression? Reply \`caused-by: #N\` naming the ticket or PR that introduced it. ${REGRESSION_MARKER}`,
    ),
  ];
}

function estimateReminder(payload: IssuesPayload, comments: IssueComment[]): Operation[] {
  if (alreadyPosted(comments, ESTIMATE_MARKER)) return [];
  if (comments.some((c) => estimateHours(c.body) !== undefined)) return [];

  return [
    comment(
      payload,
      `No estimate yet: reply \`estimate: 2d\` (h, d or w) before work starts, if you have one. ${ESTIMATE_MARKER}`,
    ),
  ];
}

// The hidden marker is what makes a reminder "at most once": it survives edits
// to the comment and is invisible once rendered, so nobody copies it by accident.
function alreadyPosted(comments: IssueComment[], marker: string): boolean {
  return comments.some((c) => (c.body ?? "").includes(marker));
}

// GitHub label names are unique regardless of case.
function sameLabel(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function comment(payload: IssuesPayload, body: string): Operation {
  return {
    kind: "create-issue-comment",
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issueNumber: payload.issue.number,
    body,
  };
}

function decidePullRequest(payload: PullRequestPayload, options: Options): Operation[] {
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

type IssuesPayload = {
  action: string;
  label?: { name: string };
  issue: { number: number; body: string | null; pull_request?: unknown };
  repository: { name: string; owner: { login: string } };
};
