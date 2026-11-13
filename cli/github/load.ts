// Turns the GitHub source's raw `gh api` answers into the CLI's GitHub model.
import { ACTION_WORKFLOW, causedBy } from "../conventions.ts";
import { parseRecords, type SessionRecord } from "../records.ts";
import type { GitHubSource } from "./source.ts";

export interface Repo {
  /** `owner/name` */
  fullName: string;
  defaultBranch: string;
  /** Private, or of unknown visibility: either way it is anonymized unless the config says otherwise. */
  private: boolean;
  url: string;
}

export interface Review {
  at: Date;
  /** `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, `DISMISSED`. */
  state: string;
  /** By a bot (an app or an Action), not a person. */
  byBot: boolean;
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
  /** Its description, for case-study drafts only; it never reaches the dataset. */
  body: string;
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
  /** Whether `commits` lists every commit; true when GitHub did not say. */
  commitsComplete?: boolean;
  /** The earliest authored date among its commits; undefined when GitHub returned none. */
  firstCommitAt: Date | undefined;
  /** Its commits (first 100), oldest first as GitHub lists them. Commit messages never reach the dataset. */
  commits: Commit[];
  /** Its current labels (first 20). */
  labels: string[];
  /** Numbers written `#N` in its title or body, in order, without repeats. */
  references: number[];
  /** When its reviews requesting changes were submitted (first 100). */
  changesRequestedAt: Date[];
  /** Its reviews (first 100), oldest first as GitHub lists them; none in data read before reviews were. */
  reviews?: Review[];
  /** When it was last marked ready for review, for a PR opened as a draft. */
  readyForReviewAt?: Date | undefined;
  /** The commit its merge made on its base branch (a merge, squash or the last rebased commit); undefined when GitHub did not say. */
  mergeCommitOid?: string | undefined;
}

/** What a commit's trailers say about who wrote it. */
export interface CommitTrailers {
  /** A `Co-Authored-By:` trailer names Claude: a name starting with "Claude", or an anthropic.com address. */
  claudeCoAuthor: boolean;
  /** A `Claude-Session:` trailer: made in a Claude Code cloud session, which leaves no local transcript. */
  cloudSession: boolean;
  /**
   * That cloud session's id (`session_…`), from the trailer's link
   * (`https://claude.ai/code/session_…`); undefined when it names none. Read
   * only to suggest `claude --teleport`; never published.
   */
  cloudSessionId?: string | undefined;
}

/** One commit of a PR, as its commit listing shows it. */
export interface Commit extends CommitTrailers {
  /** The session records its message carries (`records.ts`); none for a commit made outside a recorded session. */
  records: SessionRecord[];
  oid: string;
  /** Its parents' oids: two or more for a merge. */
  parents: string[];
  /** The first line of its message. */
  subject: string;
  authoredAt: Date | undefined;
  /** Its own diff against its first parent. */
  additions: number;
  deletions: number;
  /** Undefined when GitHub could not say. */
  changedFiles: number | undefined;
  /** For a revert (`git revert`), the commit it reverts: from its `This reverts commit <sha>.` line. */
  reverts?: string | undefined;
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
  /** How long its first attempt ran, start to last update, in ms; undefined while it runs or when not recorded. */
  firstAttemptMs?: number | undefined;
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
  /** Its description, for case-study drafts only; it never reaches the dataset. */
  body: string;
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
  /** When it was opened; undefined in data read before. */
  createdAt?: Date | undefined;
  /** When it was closed, whatever the reason. */
  closedAt?: Date | undefined;
  /** Issue numbers named by `caused-by: #N` lines in its body or comments, in order, without repeats. */
  causedBy: number[];
  /** Closed as completed (not as not planned or a duplicate): the regression was fixed. */
  fixed: boolean;
}

export interface GitHubData {
  repo: Repo;
  /** Merged PRs, whatever their base branch. */
  pullRequests: PullRequest[];
  issues: Issue[];
  regressions: RegressionIssue[];
  /** Actions runs, newest first, GitHub's own `dynamic` runs and the installed agentic-metrics workflow's left out. */
  workflowRuns: WorkflowRun[];
  /** The installed agentic-metrics workflow's runs, newest first: whether the Action is installed and allowed to run. */
  actionRuns: ActionRun[];
  /** PRs closed without merging. */
  abandonedPullRequests: AbandonedPullRequest[];
}

/** A PR closed without being merged (GLOSSARY.md). */
export interface AbandonedPullRequest {
  number: number;
  createdAt: Date;
  closedAt: Date;
  baseRefName: string;
  headRefName: string;
  /** Issue numbers in this repo it would have closed. */
  closes: number[];
  author: string | undefined;
  /** First line of each of its commits (first 100). */
  commitSubjects: string[];
}

/** A run of the agentic-metrics workflow `init` installs. */
export interface ActionRun {
  createdAt: Date;
  /** Undefined while it runs. `startup_failure` when the repo's settings would not let it start. */
  conclusion: string | undefined;
}

interface RawRepo {
  full_name: string;
  default_branch: string;
  private?: boolean;
  html_url: string;
}

interface RawClosedPullRequest {
  number: number;
  createdAt: string;
  closedAt: string | null;
  baseRefName: string;
  headRefName: string;
  author: { login: string } | null;
  closingIssuesReferences: { nodes: { number: number; repository: { nameWithOwner: string } }[] };
  commits?: { nodes: { commit: { messageHeadline?: string } }[] };
}

interface RawPullRequest {
  number: number;
  mergeCommit?: { oid: string } | null;
  title: string;
  url: string;
  body?: string | null;
  createdAt: string;
  mergedAt: string | null;
  baseRefName: string;
  headRefName: string;
  closingIssuesReferences: { nodes: { number: number; repository: { nameWithOwner: string } }[] };
  author?: { login: string } | null;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  commits?: { totalCount?: number; nodes: { commit: RawCommit }[] };
  labels?: RawLabels;
  files?: { totalCount: number; nodes: ChangedFile[] } | null;
  reviews?: { nodes: { submittedAt: string | null; state?: string; author?: { __typename?: string } | null }[] };
  timelineItems?: { nodes: { createdAt?: string }[] };
}

interface RawCommit {
  oid?: string;
  authoredDate?: string;
  messageHeadline?: string;
  messageBody?: string;
  additions?: number;
  deletions?: number;
  changedFilesIfAvailable?: number | null;
  parents?: { nodes: { oid: string }[] };
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
  run_started_at?: string;
  updated_at?: string;
  first_attempt?: { conclusion: string | null; status: string; run_started_at?: string; updated_at?: string };
}

interface RawIssue {
  number: number;
  title: string;
  url: string;
  body?: string | null;
  createdAt: string;
  timelineItems: { nodes: { __typename: string; createdAt?: string; label?: { name: string } }[] };
  subIssues?: { totalCount: number };
  labels?: RawLabels;
  comments?: { nodes: { createdAt: string; body: string; author: { __typename: string } | null }[] };
}

interface RawRegressionIssue {
  number: number;
  createdAt?: string;
  body: string;
  closedAt?: string | null;
  stateReason?: string | null;
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
              body: pr.body ?? "",
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
              commits: (pr.commits?.nodes ?? []).map((node) => commitOf(node.commit)),
              commitsComplete: pr.commits?.totalCount === undefined || (pr.commits.nodes.length >= pr.commits.totalCount),
              labels: labelNames(pr.labels),
              references: references(`${pr.title}\n${pr.body ?? ""}`),
              // Reviews recorded before their state was read were changes-requested ones: the query asked for no other.
              changesRequestedAt: (pr.reviews?.nodes ?? []).flatMap((review) =>
                review.submittedAt === null || (review.state ?? "CHANGES_REQUESTED") !== "CHANGES_REQUESTED" ? [] : [new Date(review.submittedAt)],
              ),
              reviews: (pr.reviews?.nodes ?? []).flatMap((review) =>
                review.submittedAt === null || review.state === undefined
                  ? []
                  : [{ at: new Date(review.submittedAt), state: review.state, byBot: review.author?.__typename === "Bot" }],
              ),
              readyForReviewAt: (pr.timelineItems?.nodes ?? []).flatMap((event) => (event.createdAt ? [new Date(event.createdAt)] : [])).sort((a, b) => b.getTime() - a.getTime())[0],
              mergeCommitOid: pr.mergeCommit?.oid ?? undefined,
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
      body: issue.body ?? "",
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
      return {
        number: issue.number,
        createdAt: issue.createdAt ? new Date(issue.createdAt) : undefined,
        closedAt: issue.closedAt ? new Date(issue.closedAt) : undefined,
        causedBy: causedBy([issue.body, ...comments.map((comment) => comment.body)]),
        // Closed as not planned or as a duplicate is not a fix.
        fixed: Boolean(issue.closedAt) && (issue.stateReason ?? "COMPLETED") === "COMPLETED",
      };
    });

  const runPages = (await source.read("workflow-runs")) as { workflow_runs: RawRun[] }[];
  const rawRuns = runPages.flatMap((page) => page.workflow_runs);
  const actionRuns = rawRuns
    .filter((run) => run.path === ACTION_WORKFLOW)
    .map((run): ActionRun => ({ createdAt: new Date(run.created_at), conclusion: run.status === "completed" ? (run.conclusion ?? undefined) : undefined }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const workflowRuns = rawRuns
    // GitHub's own runs (CodeQL, Dependabot) and the Action `init` installs are not CI.
    .filter((run) => run.event !== "dynamic" && run.path !== ACTION_WORKFLOW)
    .map((run): WorkflowRun => {
      const conclusion = run.status === "completed" ? (run.conclusion ?? undefined) : undefined;
      const first = run.run_attempt <= 1 ? { status: run.status, conclusion: run.conclusion, run_started_at: run.run_started_at, updated_at: run.updated_at } : run.first_attempt;
      const started = Date.parse(first?.run_started_at ?? "");
      const ended = Date.parse(first?.updated_at ?? "");
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
        firstAttemptMs: first?.status === "completed" && Number.isFinite(started) && Number.isFinite(ended) && ended >= started ? ended - started : undefined,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);

  const closedPages = (await source.read("closed-pull-requests")) as Pages<"pullRequests", RawClosedPullRequest>;
  const abandonedPullRequests = closedPages
    .flatMap((page) => page.data.repository.pullRequests.nodes)
    .filter((pr) => pr.closedAt !== null)
    .map(
      (pr): AbandonedPullRequest => ({
        number: pr.number,
        createdAt: new Date(pr.createdAt),
        closedAt: new Date(pr.closedAt ?? pr.createdAt),
        baseRefName: pr.baseRefName,
        headRefName: pr.headRefName,
        closes: pr.closingIssuesReferences.nodes.filter((node) => node.repository.nameWithOwner.toLowerCase() === repo.fullName.toLowerCase()).map((node) => node.number),
        author: pr.author?.login.replace(/\[bot\]$/, ""),
        commitSubjects: (pr.commits?.nodes ?? []).flatMap((node) => (node.commit.messageHeadline === undefined ? [] : [node.commit.messageHeadline])),
      }),
    )
    .sort((a, b) => a.number - b.number);

  return { repo, pullRequests, issues, regressions, workflowRuns, actionRuns, abandonedPullRequests };
}

/** `#N` not inside a word or a path (so `owner/repo#N` and `ADR#N`-like tokens are skipped). */
const REFERENCE = /(?<![\w/])#(\d+)\b/g;

function references(text: string): number[] {
  return [...new Set([...text.matchAll(REFERENCE)].map((match) => Number(match[1])))];
}

type RawLabels = { nodes: { name: string }[] } | null;

function labelNames(labels: RawLabels | undefined): string[] {
  return (labels?.nodes ?? []).map((label) => label.name);
}

/** `Co-Authored-By: Name <email>` at the start of a line, any case. */
const CO_AUTHOR = /^[ \t]*co-authored-by:[ \t]*(.*?)[ \t]*<([^>]*)>/gim;
const CLOUD_SESSION = /^[ \t]*claude-session:[ \t]*(.*)$/im;
const CLOUD_SESSION_ID = /\b(session_[A-Za-z0-9]+)\b/;

function commitOf(raw: RawCommit): Commit {
  return {
    oid: raw.oid ?? "",
    parents: (raw.parents?.nodes ?? []).map((parent) => parent.oid),
    subject: raw.messageHeadline ?? "",
    authoredAt: raw.authoredDate === undefined ? undefined : new Date(raw.authoredDate),
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changedFilesIfAvailable ?? undefined,
    ...trailersOf(raw.messageBody ?? ""),
    records: parseRecords(raw.messageBody ?? ""),
    reverts: /^This reverts commit ([0-9a-f]{7,40})\b/m.exec(raw.messageBody ?? "")?.[1],
  };
}

function trailersOf(body: string): CommitTrailers {
  const claudeCoAuthor = [...body.matchAll(CO_AUTHOR)].some(
    ([, name = "", email = ""]) => /^claude\b/i.test(name) || /@anthropic\.com$/i.test(email),
  );
  const cloud = CLOUD_SESSION.exec(body);
  return { claudeCoAuthor, cloudSession: cloud !== null, cloudSessionId: cloud ? CLOUD_SESSION_ID.exec(cloud[1] ?? "")?.[1] : undefined };
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
