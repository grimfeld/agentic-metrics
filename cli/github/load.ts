// Turns the GitHub source's raw `gh api` answers into the CLI's GitHub model.
import type { GitHubSource } from "./source.ts";

export interface Repo {
  /** `owner/name` */
  fullName: string;
  defaultBranch: string;
}

export interface PullRequest {
  number: number;
  createdAt: Date;
  mergedAt: Date;
  baseRefName: string;
  headRefName: string;
  /** Issue numbers in this repo the PR closes (GitHub's closing references). */
  closes: number[];
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
  createdAt: Date;
  /** Label additions, oldest first. */
  labelled: LabelEvent[];
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

export interface GitHubData {
  repo: Repo;
  /** Merged PRs, whatever their base branch. */
  pullRequests: PullRequest[];
  issues: Issue[];
}

interface RawRepo {
  full_name: string;
  default_branch: string;
}

interface RawPullRequest {
  number: number;
  createdAt: string;
  mergedAt: string | null;
  baseRefName: string;
  headRefName: string;
  closingIssuesReferences: { nodes: { number: number; repository: { nameWithOwner: string } }[] };
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  commits?: { nodes: { commit: { authoredDate: string } }[] };
  files?: { totalCount: number; nodes: ChangedFile[] } | null;
}

interface RawIssue {
  number: number;
  createdAt: string;
  timelineItems: { nodes: { __typename: string; createdAt?: string; label?: { name: string } }[] };
  subIssues?: { totalCount: number };
  comments?: { nodes: { createdAt: string; body: string; author: { __typename: string } | null }[] };
}

type Pages<K extends string, N> = { data: { repository: Record<K, { nodes: N[] }> } }[];

export async function loadGitHub(source: GitHubSource): Promise<GitHubData> {
  const rawRepo = (await source.read("repo")) as RawRepo;
  const repo: Repo = { fullName: rawRepo.full_name, defaultBranch: rawRepo.default_branch };

  const prPages = (await source.read("pull-requests")) as Pages<"pullRequests", RawPullRequest>;
  const pullRequests = prPages
    .flatMap((page) => page.data.repository.pullRequests.nodes)
    .flatMap((pr): PullRequest[] =>
      pr.mergedAt === null
        ? []
        : [
            {
              number: pr.number,
              createdAt: new Date(pr.createdAt),
              mergedAt: new Date(pr.mergedAt),
              baseRefName: pr.baseRefName,
              headRefName: pr.headRefName,
              closes: pr.closingIssuesReferences.nodes
                .filter((ref) => ref.repository.nameWithOwner.toLowerCase() === repo.fullName.toLowerCase())
                .map((ref) => ref.number),
              ...diffOf(pr),
            },
          ],
    );

  const issuePages = (await source.read("issues")) as Pages<"issues", RawIssue>;
  const issues = issuePages
    .flatMap((page) => page.data.repository.issues.nodes)
    .map((issue): Issue => ({
      number: issue.number,
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

  return { repo, pullRequests, issues };
}

/** A PR's diff stats and first commit. Missing fields read as an empty, incomplete diff. */
function diffOf(pr: RawPullRequest) {
  const files = pr.files?.nodes ?? [];
  const commitTimes = (pr.commits?.nodes ?? []).map((node) => Date.parse(node.commit.authoredDate));
  return {
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changedFiles: pr.changedFiles ?? files.length,
    files: files.map(({ path, additions, deletions }) => ({ path, additions, deletions })),
    filesComplete: pr.files != null && files.length >= pr.files.totalCount,
    firstCommitAt: commitTimes.length > 0 ? new Date(Math.min(...commitTimes)) : undefined,
  };
}
