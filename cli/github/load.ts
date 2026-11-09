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
  /** The earliest authored date among its commits; undefined when GitHub returned none. */
  firstCommitAt: Date | undefined;
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
  /** Closed as completed (not as not planned or a duplicate): the regression was fixed. */
  fixed: boolean;
}

export interface GitHubData {
  repo: Repo;
  /** Merged PRs, whatever their base branch. */
  pullRequests: PullRequest[];
  issues: Issue[];
  regressions: RegressionIssue[];
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
  commits?: { nodes: { commit: { authoredDate?: string; messageHeadline?: string } }[] };
  files?: { totalCount: number; nodes: ChangedFile[] } | null;
}

interface RawIssue {
  number: number;
  title: string;
  url: string;
  body?: string | null;
  createdAt: string;
  timelineItems: { nodes: { __typename: string; createdAt?: string; label?: { name: string } }[] };
  subIssues?: { totalCount: number };
  comments?: { nodes: { createdAt: string; body: string; author: { __typename: string } | null }[] };
}

interface RawRegressionIssue {
  number: number;
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
        causedBy: causedBy([issue.body, ...comments.map((comment) => comment.body)]),
        // Closed as not planned or as a duplicate is not a fix.
        fixed: Boolean(issue.closedAt) && (issue.stateReason ?? "COMPLETED") === "COMPLETED",
      };
    });

  return { repo, pullRequests, issues, regressions };
}

/** A line starting with `caused-by: #N`, any case. A mention mid-line (such as the Action's question) is not one. */
const CAUSED_BY = /^[ \t]*caused-by:[ \t]*#(\d+)\b/gim;

function causedBy(texts: string[]): number[] {
  const numbers = texts.flatMap((text) => [...text.matchAll(CAUSED_BY)].map((match) => Number(match[1])));
  return [...new Set(numbers)];
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
