// Turns the GitHub source's raw `gh api` answers into the CLI's GitHub model.
import type { GitHubSource } from "./source.ts";

export interface Repo {
  /** `owner/name` */
  fullName: string;
  defaultBranch: string;
  /** Private, or of unknown visibility: either way it is anonymized unless the config says otherwise. */
  private: boolean;
  url: string;
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  createdAt: Date;
  mergedAt: Date;
  baseRefName: string;
  headRefName: string;
  /** Issue numbers in this repo the PR closes (GitHub's closing references). */
  closes: number[];
  /** The author's login, without a bot's `[bot]` suffix; undefined for a deleted account. */
  author: string | undefined;
  /** First line of each of its commits (first 100). */
  commitSubjects: string[];
  /** Lines added and deleted, and files changed, over the whole diff. */
  additions: number;
  deletions: number;
  changedFiles: number;
  /** Its changed files, possibly only the first 100. */
  files: ChangedFile[];
  /** Whether `files` lists every changed file. */
  filesComplete: boolean;
  /** The earliest authored date among its commits; undefined when GitHub returned none. */
  firstCommitAt: Date | undefined;
  /** What the trailers of its commits (first 100) say. Commit messages never reach the dataset. */
  commits: CommitTrailers[];
  /** Its current labels (first 20). */
  labels: string[];
  /** Numbers written `#N` in its title or body, in order, without repeats. The text itself is not kept. */
  references: number[];
  /** When its reviews requesting changes were submitted (first 100). */
  changesRequestedAt: Date[];
}

/** What a commit's trailers say about who wrote it. */
export interface CommitTrailers {
  /** A `Co-Authored-By:` trailer names Claude: a name starting with "Claude", or an anthropic.com address. */
  claudeCoAuthor: boolean;
  /** A `Claude-Session:` trailer: made in a Claude Code cloud session, which leaves no local transcript. */
  cloudSession: boolean;
}

/** One GitHub Actions workflow run, as the runs listing shows it. */
export interface WorkflowRun {
  id: number;
  /** The workflow's name when it ran; it can change over time, unlike `path`. */
  name: string;
  /** The workflow file, e.g. `.github/workflows/check.yml`; `dynamic/…` for GitHub's own (CodeQL, Dependabot). */
  path: string;
  /** `pull_request`, `push`, `schedule`, `dynamic`… */
  event: string;
  headBranch: string;
  headSha: string;
  createdAt: Date;
  /** The conclusion of its latest attempt; undefined while it runs. */
  conclusion: string | undefined;
  /** The conclusion of its first attempt; undefined while it runs, or when a re-run's first attempt was not read. */
  firstAttemptConclusion: string | undefined;
}

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface LabelEvent {
  label: string;
  at: Date;
}

export interface Issue {
  number: number;
  title: string;
  url: string;
  createdAt: Date;
  /** Label additions, oldest first. */
  labelled: LabelEvent[];
  /** Number of sub-issues. */
  subIssues: number;
  /** Its current labels (first 20). */
  labels: string[];
  /** Its comments (the first 100), oldest first. Bodies never reach the dataset. */
  comments: Comment[];
}

export interface Comment {
  at: Date;
  body: string;
  /** Posted by a bot (an Action or an app), not a person. */
  byBot: boolean;
}

/** An issue labelled as a regression. */
export interface RegressionIssue {
  number: number;
  /** Issue numbers named by `caused-by: #N` lines in its body or comments, in order, without repeats. */
  causedBy: number[];
}

export interface GitHubData {
  repo: Repo;
  /** Merged PRs, whatever their base branch. */
  pullRequests: PullRequest[];
  issues: Issue[];
  regressions: RegressionIssue[];
  /** Actions runs, newest first, GitHub's own `dynamic` runs left out. */
  workflowRuns: WorkflowRun[];
}

interface RawRepo {
  full_name: string;
  default_branch: string;
  private?: boolean;
  html_url: string;
}

interface RawPullRequest {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  mergedAt: string | null;
  baseRefName: string;
  headRefName: string;
  closingIssuesReferences: { nodes: { number: number; repository: { nameWithOwner: string } }[] };
  author?: { login: string } | null;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  commits?: { nodes: { commit: { authoredDate?: string; messageHeadline?: string; messageBody?: string } }[] };
  labels?: RawLabels;
  files?: { totalCount: number; nodes: ChangedFile[] } | null;
  body?: string;
  reviews?: { nodes: { submittedAt: string | null }[] };
}

interface RawRun {
  id: number;
  name: string;
  path: string;
  event: string;
  head_branch: string | null;
  head_sha: string;
  created_at: string;
  status: string;
  conclusion: string | null;
  run_attempt: number;
  first_attempt?: { conclusion: string | null; status: string };
}

interface RawIssue {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  timelineItems: { nodes: { __typename: string; createdAt?: string; label?: { name: string } }[] };
  subIssues?: { totalCount: number };
  labels?: RawLabels;
  comments?: { nodes: { createdAt: string; body: string; author: { __typename: string } | null }[] };
}

interface RawRegressionIssue {
  number: number;
  body: string;
  comments: { nodes: { createdAt: string; body: string }[] };
}

type Pages<K extends string, N> = { data: { repository: Record<K, { nodes: N[] }> } }[];

export async function loadGitHub(source: GitHubSource): Promise<GitHubData> {
  const rawRepo = (await source.read("repo")) as RawRepo;
  const repo: Repo = {
    fullName: rawRepo.full_name,
    defaultBranch: rawRepo.default_branch,
    private: rawRepo.private !== false,
    url: rawRepo.html_url,
  };

  const prPages = (await source.read("pull-requests")) as Pages<"pullRequests", RawPullRequest>;
  const pullRequests = prPages
    .flatMap((page) => page.data.repository.pullRequests.nodes)
    .flatMap((pr): PullRequest[] =>
      pr.mergedAt === null
        ? []
        : [
            {
              number: pr.number,
              title: pr.title,
              url: pr.url,
              createdAt: new Date(pr.createdAt),
              mergedAt: new Date(pr.mergedAt),
              baseRefName: pr.baseRefName,
              headRefName: pr.headRefName,
              closes: pr.closingIssuesReferences.nodes
                .filter((ref) => ref.repository.nameWithOwner.toLowerCase() === repo.fullName.toLowerCase())
                .map((ref) => ref.number),
              author: pr.author?.login.replace(/\[bot\]$/, ""),
              commitSubjects: (pr.commits?.nodes ?? []).flatMap((node) =>
                node.commit.messageHeadline === undefined ? [] : [node.commit.messageHeadline],
              ),
              ...diffOf(pr),
              commits: (pr.commits?.nodes ?? []).map((node) => trailersOf(node.commit.messageBody ?? "")),
              labels: labelNames(pr.labels),
              references: references(`${pr.title}\n${pr.body ?? ""}`),
              changesRequestedAt: (pr.reviews?.nodes ?? []).flatMap((review) =>
                review.submittedAt === null ? [] : [new Date(review.submittedAt)],
              ),
            },
          ],
    );

  const issuePages = (await source.read("issues")) as Pages<"issues", RawIssue>;
  const issues = issuePages
    .flatMap((page) => page.data.repository.issues.nodes)
    .map((issue): Issue => ({
      number: issue.number,
      title: issue.title,
      url: issue.url,
      createdAt: new Date(issue.createdAt),
      labelled: issue.timelineItems.nodes
        .flatMap((event) =>
          event.__typename === "LabeledEvent" && event.label && event.createdAt
            ? [{ label: event.label.name, at: new Date(event.createdAt) }]
            : [],
        )
        .sort((a, b) => a.at.getTime() - b.at.getTime()),
      subIssues: issue.subIssues?.totalCount ?? 0,
      labels: labelNames(issue.labels),
      comments: (issue.comments?.nodes ?? [])
        .map((comment) => ({ at: new Date(comment.createdAt), body: comment.body, byBot: comment.author?.__typename === "Bot" }))
        .sort((a, b) => a.at.getTime() - b.at.getTime()),
    }));

  const regressionPages = (await source.read("regressions")) as Pages<"issues", RawRegressionIssue>;
  const regressions = regressionPages
    .flatMap((page) => page.data.repository.issues.nodes)
    .map((issue): RegressionIssue => {
      const comments = [...issue.comments.nodes].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      return { number: issue.number, causedBy: causedBy([issue.body, ...comments.map((comment) => comment.body)]) };
    });

  const runPages = (await source.read("workflow-runs")) as { workflow_runs: RawRun[] }[];
  const workflowRuns = runPages
    .flatMap((page) => page.workflow_runs)
    .filter((run) => run.event !== "dynamic")
    .map((run): WorkflowRun => {
      const conclusion = run.status === "completed" ? (run.conclusion ?? undefined) : undefined;
      const first = run.run_attempt <= 1 ? { status: run.status, conclusion: run.conclusion } : run.first_attempt;
      return {
        id: run.id,
        name: run.name,
        path: run.path,
        event: run.event,
        headBranch: run.head_branch ?? "",
        headSha: run.head_sha,
        createdAt: new Date(run.created_at),
        conclusion,
        firstAttemptConclusion: first?.status === "completed" ? (first.conclusion ?? undefined) : undefined,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);

  return { repo, pullRequests, issues, regressions, workflowRuns };
}

/** `#N` not inside a word or a path (so `owner/repo#N` and `ADR#N`-like tokens are skipped). */
const REFERENCE = /(?<![\w/])#(\d+)\b/g;

function references(text: string): number[] {
  return [...new Set([...text.matchAll(REFERENCE)].map((match) => Number(match[1])))];
}

/** A line starting with `caused-by: #N`, any case. A mention mid-line (such as the Action's question) is not one. */
const CAUSED_BY = /^[ \t]*caused-by:[ \t]*#(\d+)\b/gim;

function causedBy(texts: string[]): number[] {
  const numbers = texts.flatMap((text) => [...text.matchAll(CAUSED_BY)].map((match) => Number(match[1])));
  return [...new Set(numbers)];
}

type RawLabels = { nodes: { name: string }[] } | null;

function labelNames(labels: RawLabels | undefined): string[] {
  return (labels?.nodes ?? []).map((label) => label.name);
}

/** `Co-Authored-By: Name <email>` at the start of a line, any case. */
const CO_AUTHOR = /^[ \t]*co-authored-by:[ \t]*(.*?)[ \t]*<([^>]*)>/gim;
const CLOUD_SESSION = /^[ \t]*claude-session:/im;

function trailersOf(body: string): CommitTrailers {
  const claudeCoAuthor = [...body.matchAll(CO_AUTHOR)].some(
    ([, name = "", email = ""]) => /^claude\b/i.test(name) || /@anthropic\.com$/i.test(email),
  );
  return { claudeCoAuthor, cloudSession: CLOUD_SESSION.test(body) };
}

/** A PR's diff stats and first commit. Missing fields read as an empty, incomplete diff. */
function diffOf(pr: RawPullRequest) {
  const files = pr.files?.nodes ?? [];
  const commitTimes = (pr.commits?.nodes ?? []).flatMap((node) =>
    node.commit.authoredDate === undefined ? [] : [Date.parse(node.commit.authoredDate)],
  );
  return {
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changedFiles: pr.changedFiles ?? files.length,
    files: files.map(({ path, additions, deletions }) => ({ path, additions, deletions })),
    filesComplete: pr.files != null && files.length >= pr.files.totalCount,
    firstCommitAt: commitTimes.length > 0 ? new Date(Math.min(...commitTimes)) : undefined,
  };
}
