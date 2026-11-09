// The GitHub source: the CLI's swappable boundary to GitHub.
//
// Every read is one named request whose answer is the raw JSON `gh api`
// prints. `ghSource` runs `gh` (the user's own login, so no token to store);
// `fixtureSource` reads the same JSON from `<dir>/<request>.json`, so a
// fixture folder is a recording of `gh api` output, one file per request.
//
// To read something new from GitHub, add a request here and its file to the
// fixture folders. A request that lists items carrying an update time should
// also get an entry in `INCREMENTAL`: collection then caches its items and,
// after the first run, asks only for those updated since (see `cache.ts`).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

export type GitHubRequest = "repo" | "pull-requests" | "issues" | "regressions";

/** The label that marks a bug as a regression; `init` creates it. */
export const REGRESSION_LABEL = "regression";

export interface ReadOptions {
  /**
   * Only items updated at or after this time are needed. A source may return
   * more (the cache merges by key), never fewer. Non-incremental requests
   * ignore it.
   */
  since?: Date | undefined;
}

export interface GitHubSource {
  read(request: GitHubRequest, options?: ReadOptions): Promise<unknown>;
}

/** How to take a list request's answer apart into items, and build an answer back from items. */
export interface IncrementalRequest {
  /** Changes whenever what an item holds changes, so items cached before are dropped. */
  version: string;
  items(raw: unknown): unknown[];
  /** An answer of the request's own shape, holding these items. */
  answer(items: unknown[]): unknown;
  /** Identifies an item across reads. */
  key(item: unknown): string;
  /** ISO time of the item's last update, or undefined when the answer doesn't carry it. */
  updatedAt(item: unknown): string | undefined;
}

const PULL_REQUESTS_QUERY = `
query($owner: String!, $name: String!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 50, after: $endCursor, states: [MERGED], orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number createdAt updatedAt mergedAt baseRefName headRefName
        author { login __typename }
        closingIssuesReferences(first: 50) { nodes { number repository { nameWithOwner } } }
      }
    }
  }
}`;

const ISSUES_QUERY = `
query($owner: String!, $name: String!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 50, after: $endCursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number createdAt updatedAt closedAt
        timelineItems(first: 100, itemTypes: [LABELED_EVENT]) {
          nodes { __typename ... on LabeledEvent { createdAt label { name } } }
        }
      }
    }
  }
}`;

interface GraphQLNode {
  number: number;
  updatedAt?: string;
}

interface GraphQLConnection {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: GraphQLNode[];
}

interface GraphQLPage {
  data: { repository: Record<string, GraphQLConnection | undefined> };
}

interface GraphQLRequest extends IncrementalRequest {
  query: string;
  connection: string;
}

/**
 * A connection under `repository`, keyed by `number`. Its query must order by
 * UPDATED_AT DESC so `ghSource` can stop paging at the first stale item.
 */
function graphqlConnection(connection: string, query: string): GraphQLRequest {
  return {
    query,
    connection,
    version: createHash("sha256").update(query).digest("hex").slice(0, 16),
    items: (raw) => (raw as GraphQLPage[]).flatMap((page) => page.data.repository[connection]?.nodes ?? []),
    answer: (items) => [
      { data: { repository: { [connection]: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: items } } } },
    ],
    key: (item) => String((item as GraphQLNode).number),
    updatedAt: (item) => (item as GraphQLNode).updatedAt,
  };
}

const GRAPHQL_REQUESTS = {
  "pull-requests": graphqlConnection("pullRequests", PULL_REQUESTS_QUERY),
  issues: graphqlConnection("issues", ISSUES_QUERY),
};

/** The requests collection reads incrementally. */
export const INCREMENTAL: Partial<Record<GitHubRequest, IncrementalRequest>> = GRAPHQL_REQUESTS;

// Issues labelled as regressions, with the text a `caused-by: #N` line may sit
// in. Text is read here only to find that line; it never reaches the dataset.
// Not incremental: an issue whose label is removed drops out of this filtered
// list, which a merge of updated items could never notice. The list is short.
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

  /** Pages through a connection, newest-updated first, until a page reaches items updated before `since`. */
  const graphql = async ({ query, connection }: GraphQLRequest, since: Date | undefined): Promise<GraphQLPage[]> => {
    const pages: GraphQLPage[] = [];
    let cursor: string | null = null;
    for (;;) {
      const args = ["graphql", "-F", "owner={owner}", "-F", "name={repo}", "-f", `query=${query}`];
      if (cursor !== null) args.push("-f", `endCursor=${cursor}`);
      const page = (await gh(args)) as GraphQLPage;
      pages.push(page);
      const found = page.data.repository[connection];
      const oldest = found?.nodes.at(-1)?.updatedAt;
      const stale = since !== undefined && oldest !== undefined && new Date(oldest) < since;
      if (!found?.pageInfo.hasNextPage || stale) return pages;
      cursor = found.pageInfo.endCursor;
    }
  };

  /** Reads every page of a query at once. */
  const graphqlAll = (query: string, variables: string[] = []) =>
    gh(["graphql", "--paginate", "--slurp", "-F", "owner={owner}", "-F", "name={repo}", ...variables, "-f", `query=${query}`]);

  return {
    read(request, readOptions) {
      switch (request) {
        case "repo":
          return gh(["repos/{owner}/{repo}"]);
        case "pull-requests":
        case "issues":
          return graphql(GRAPHQL_REQUESTS[request], readOptions?.since);
        case "regressions":
          return graphqlAll(REGRESSIONS_QUERY, ["-f", `label=${REGRESSION_LABEL}`]);
      }
    },
  };
}

/**
 * Reads recorded `gh api` answers from `<dir>/<request>.json`. With `since`,
 * an incremental request answers only with the recorded items updated at or
 * after it; items recorded without an update time are always included.
 */
export function fixtureSource(dir: string): GitHubSource {
  return {
    async read(request, options) {
      const raw = JSON.parse(await readFile(join(dir, `${request}.json`), "utf8")) as unknown;
      const incremental = INCREMENTAL[request];
      const since = options?.since;
      if (!incremental || !since) return raw;
      return incremental.answer(
        incremental.items(raw).filter((item) => {
          const updatedAt = incremental.updatedAt(item);
          return updatedAt === undefined || new Date(updatedAt) >= since;
        }),
      );
    },
  };
}
