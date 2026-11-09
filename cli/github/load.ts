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
}

interface RawIssue {
  number: number;
  createdAt: string;
  timelineItems: { nodes: { __typename: string; createdAt?: string; label?: { name: string } }[] };
}

interface RawRegressionIssue {
  number: number;
  body: string;
  comments: { nodes: { createdAt: string; body: string }[] };
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

  const regressionPages = (await source.read("regressions")) as Pages<"issues", RawRegressionIssue>;
  const regressions = regressionPages
    .flatMap((page) => page.data.repository.issues.nodes)
    .map((issue): RegressionIssue => {
      const comments = [...issue.comments.nodes].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      return { number: issue.number, causedBy: causedBy([issue.body, ...comments.map((comment) => comment.body)]) };
    });

  return { repo, pullRequests, issues, regressions };
}

/** A line starting with `caused-by: #N`, any case. A mention mid-line (such as the Action's question) is not one. */
const CAUSED_BY = /^[ \t]*caused-by:[ \t]*#(\d+)\b/gim;

function causedBy(texts: string[]): number[] {
  const numbers = texts.flatMap((text) => [...text.matchAll(CAUSED_BY)].map((match) => Number(match[1])));
  return [...new Set(numbers)];
}
