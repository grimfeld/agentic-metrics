// The GitHub source: the CLI's swappable boundary to GitHub.
//
// Every read is one named request whose answer is the raw JSON `gh api`
// prints. `ghSource` runs `gh` (the user's own login, so no token to store);
// `fixtureSource` reads the same JSON from `<dir>/<request>.json`, so a
// fixture folder is a recording of `gh api` output, one file per request.
//
// To read something new from GitHub, add a request here and its file to the
// fixture folders.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

export type GitHubRequest = "repo" | "pull-requests" | "issues" | "regressions";

/** The label that marks a bug as a regression; `init` creates it. */
export const REGRESSION_LABEL = "regression";

export interface GitHubSource {
  read(request: GitHubRequest): Promise<unknown>;
}

const PULL_REQUESTS_QUERY = `
query($owner: String!, $name: String!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 50, after: $endCursor, states: [MERGED], orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number createdAt mergedAt baseRefName headRefName
        author { login __typename }
        closingIssuesReferences(first: 50) { nodes { number repository { nameWithOwner } } }
        commits(first: 100) { nodes { commit { messageHeadline } } }
      }
    }
  }
}`;

const ISSUES_QUERY = `
query($owner: String!, $name: String!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 50, after: $endCursor, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number createdAt closedAt
        timelineItems(first: 100, itemTypes: [LABELED_EVENT]) {
          nodes { __typename ... on LabeledEvent { createdAt label { name } } }
        }
      }
    }
  }
}`;

// Issues labelled as regressions, with the text a `caused-by: #N` line may sit
// in. Text is read here only to find that line; it never reaches the dataset.
const REGRESSIONS_QUERY = `
query($owner: String!, $name: String!, $label: String!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 50, after: $endCursor, labels: [$label], orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number createdAt body
        comments(first: 100) { nodes { createdAt body } }
      }
    }
  }
}`;

const run = promisify(execFile);

/**
 * Reads GitHub through the `gh` CLI. `repo` is `owner/name`; without it, `gh`
 * resolves `{owner}/{repo}` from the git remote of the working directory.
 */
export function ghSource(options: { cwd: string; repo?: string | undefined }): GitHubSource {
  const env = options.repo ? { ...process.env, GH_REPO: options.repo } : process.env;
  const gh = async (args: string[]): Promise<unknown> => {
    const { stdout } = await run("gh", ["api", ...args], { cwd: options.cwd, env, maxBuffer: 512 * 1024 * 1024 });
    return JSON.parse(stdout) as unknown;
  };
  const graphql = (query: string, variables: string[] = []) =>
    gh(["graphql", "--paginate", "--slurp", "-F", "owner={owner}", "-F", "name={repo}", ...variables, "-f", `query=${query}`]);

  return {
    read(request) {
      switch (request) {
        case "repo":
          return gh(["repos/{owner}/{repo}"]);
        case "pull-requests":
          return graphql(PULL_REQUESTS_QUERY);
        case "issues":
          return graphql(ISSUES_QUERY);
        case "regressions":
          return graphql(REGRESSIONS_QUERY, ["-f", `label=${REGRESSION_LABEL}`]);
      }
    },
  };
}

/** Reads recorded `gh api` answers from `<dir>/<request>.json`. */
export function fixtureSource(dir: string): GitHubSource {
  return {
    async read(request) {
      return JSON.parse(await readFile(join(dir, `${request}.json`), "utf8")) as unknown;
    },
  };
}
