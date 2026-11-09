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
  /** The author's login, without a bot's `[bot]` suffix; undefined for a deleted account. */
  author: string | undefined;
  /** First line of each of its commits (first 100). */
  commitSubjects: string[];
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
  author: { login: string } | null;
  commits: { nodes: { commit: { messageHeadline: string } }[] };
}

interface RawIssue {
  number: number;
  createdAt: string;
  timelineItems: { nodes: { __typename: string; createdAt?: string; label?: { name: string } }[] };
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
              author: pr.author?.login.replace(/\[bot\]$/, ""),
              commitSubjects: pr.commits.nodes.map((node) => node.commit.messageHeadline),
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
    }));

  return { repo, pullRequests, issues };
}
