import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import type { GitHubSource } from "../../cli/github/source.ts";

// Each test describes a small repo as `gh api` would answer for it. Every issue
// is created at 00:00 and never labelled ready, so its lead time runs from
// 00:00; a PR that ends up as a ticket of its own starts when it was opened, at
// 02:00. The lead time therefore shows which ticket a PR was linked to.
const DAY = "2026-10-05";
const NOW = new Date("2026-11-09T12:00:00Z");

interface FakePr {
  number: number;
  head: string;
  base?: string;
  /** Hours after 00:00 when it merged. */
  mergedAfter: number;
  closes?: number[];
  commits?: string[];
  author?: { login: string; __typename: string } | null;
}

function at(hours: number): string {
  return new Date(Date.parse(`${DAY}T00:00:00Z`) + hours * 3_600_000).toISOString().replace(".000", "");
}

function fakeGitHub(issues: number[], prs: FakePr[]): GitHubSource {
  const answers = {
    repo: { full_name: "grimfeld/lifeline", default_branch: "master" },
    issues: [
      {
        data: {
          repository: {
            issues: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: issues.map((number) => ({ number, createdAt: at(0), closedAt: null, timelineItems: { nodes: [] } })),
            },
          },
        },
      },
    ],
    "pull-requests": [
      {
        data: {
          repository: {
            pullRequests: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: prs.map((pr) => ({
                number: pr.number,
                createdAt: at(2),
                mergedAt: at(pr.mergedAfter),
                baseRefName: pr.base ?? "master",
                headRefName: pr.head,
                author: pr.author === undefined ? { login: "grimfeld", __typename: "User" } : pr.author,
                closingIssuesReferences: {
                  nodes: (pr.closes ?? []).map((number) => ({ number, repository: { nameWithOwner: "grimfeld/lifeline" } })),
                },
                commits: { nodes: (pr.commits ?? []).map((messageHeadline) => ({ commit: { messageHeadline } })) },
              })),
            },
          },
        },
      },
    ],
  };
  return {
    read(request) {
      return Promise.resolve(answers[request]);
    },
  };
}

interface Dataset {
  tickets: number;
  pullRequests: number;
  integrationPullRequests: number;
  metrics: Record<string, { value: unknown; coverage: { tickets: number; of: number } }>;
}

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-linking-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

async function collect(github: GitHubSource, config?: object): Promise<Dataset> {
  if (config) writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify(config));
  const status = await main(["collect"], { cwd, github, now: () => NOW, stderr: (text) => assert.fail(text) });
  assert.equal(status, 0);
  return JSON.parse(readFileSync(join(cwd, "datasets/grimfeld/lifeline.json"), "utf8")) as Dataset;
}

function leadTimes(dataset: Dataset): unknown {
  return dataset.metrics["leadTime"]?.value;
}

describe("linking a PR to its ticket", () => {
  it("takes the issue number from the branch name when the PR has no closing reference", async () => {
    const data = await collect(fakeGitHub([201], [{ number: 301, head: "spec-201-library", mergedAfter: 10 }]));

    assert.equal(data.tickets, 1);
    assert.deepEqual(leadTimes(data), { p50Hours: 10, p90Hours: 10 });
  });

  it("takes `(#N)` from commit subjects when neither closing references nor the branch name an issue", async () => {
    const data = await collect(
      fakeGitHub([201], [{ number: 301, head: "library-search", mergedAfter: 10, commits: ["Add the search box (#201)"] }]),
    );

    assert.equal(data.tickets, 1);
    assert.deepEqual(leadTimes(data), { p50Hours: 10, p90Hours: 10 });
  });

  it("tries the strategies in order: closing references, then branch, then commits; the first match wins", async () => {
    // Issue #202's PRs each name another issue by a later strategy; were it
    // used, #203 or #204 would become a ticket too.
    const data = await collect(
      fakeGitHub(
        [202, 203, 204],
        [
          { number: 301, head: "spec-203-x", mergedAfter: 10, closes: [202], commits: ["Fix (#204)"] },
          { number: 302, head: "spec-202-y", mergedAfter: 20, commits: ["Fix (#204)"] },
        ],
      ),
    );

    assert.equal(data.tickets, 1);
    assert.equal(data.pullRequests, 2);
    assert.deepEqual(leadTimes(data), { p50Hours: 20, p90Hours: 20 });
  });

  it("gathers a ticket's PRs whichever strategy linked each one", async () => {
    const data = await collect(
      fakeGitHub(
        [201],
        [
          { number: 301, head: "first", mergedAfter: 10, closes: [201] },
          { number: 302, head: "spec/201-follow-up", mergedAfter: 20 },
          { number: 303, head: "cleanup", mergedAfter: 30, commits: ["Tidy", "Rename the field (#201)"] },
        ],
      ),
    );

    assert.equal(data.tickets, 1);
    assert.equal(data.pullRequests, 3);
    assert.deepEqual(leadTimes(data), { p50Hours: 30, p90Hours: 30 });
  });

  it("makes a PR its own ticket when the numbers it carries are not issues (a squash-merge's PR number, say)", async () => {
    // #300 is a PR, not an issue: GitHub's issues list does not return it.
    const data = await collect(
      fakeGitHub([201], [{ number: 301, head: "spec-300-x", mergedAfter: 10, commits: ["Merge the branch (#300)"] }]),
    );

    assert.equal(data.tickets, 1);
    assert.deepEqual(leadTimes(data), { p50Hours: 8, p90Hours: 8 });
  });

  it("reads the issue number from the branch with the repo's own regex", async () => {
    // `t201-…` doesn't match the default pattern.
    const github = fakeGitHub([201], [{ number: 301, head: "t201-state-commands", mergedAfter: 10 }]);

    assert.deepEqual(leadTimes(await collect(github)), { p50Hours: 8, p90Hours: 8 });
    assert.deepEqual(leadTimes(await collect(github, { branchRegex: "^t(\\d+)-" })), { p50Hours: 10, p90Hours: 10 });
  });

  it("fails with a clear message when the config's branch regex is not a valid pattern", async () => {
    writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify({ branchRegex: "spec-(\\d+" }));
    let error = "";
    const status = await main(["collect"], { cwd, github: fakeGitHub([], []), now: () => NOW, stderr: (text) => (error += text) });

    assert.equal(status, 1);
    assert.match(error, /branchRegex is not a valid pattern/);
  });
});

function throughputWeek(dataset: Dataset): unknown {
  return (dataset.metrics["throughput"]?.value as { weeks: unknown[] } | undefined)?.weeks;
}

describe("integration PRs", () => {
  it("keeps a batch out of ticket metrics: it is no ticket and no PR of its own, but is counted apart", async () => {
    // Lifeline's way: ticket PRs and the batch all target the default branch.
    const data = await collect(
      fakeGitHub(
        [201, 202],
        [
          { number: 301, head: "spec-201-a", mergedAfter: 10, closes: [201] },
          { number: 302, head: "spec-202-b", mergedAfter: 10 },
          { number: 310, head: "integration/2026-10-05", mergedAfter: 10, closes: [201, 202], commits: ["Merge (#301)"] },
        ],
      ),
    );

    assert.equal(data.tickets, 2);
    assert.equal(data.pullRequests, 2);
    assert.equal(data.integrationPullRequests, 1);
    assert.deepEqual(throughputWeek(data), [{ week: "2026-10-05", tickets: 2, pullRequests: 2 }]);
    assert.deepEqual(leadTimes(data), { p50Hours: 10, p90Hours: 10 });
  });

  it("is not a ticket of its own when it closes nothing", async () => {
    const data = await collect(fakeGitHub([], [{ number: 310, head: "integration/2026-10-05", mergedAfter: 10 }]));

    assert.equal(data.tickets, 0);
    assert.equal(data.pullRequests, 0);
    assert.equal(data.integrationPullRequests, 1);
    assert.equal(leadTimes(data), "unknown");
  });

  it("delivers the tickets it closes that no ticket PR delivered (work merged into the batch locally)", async () => {
    const data = await collect(
      fakeGitHub([201, 202], [{ number: 310, head: "integration/2026-10-05", mergedAfter: 30, closes: [201, 202] }]),
    );

    assert.equal(data.tickets, 2);
    assert.equal(data.pullRequests, 0);
    assert.deepEqual(leadTimes(data), { p50Hours: 30, p90Hours: 30 });
  });

  it("delivers ticket PRs merged into its branch when it merges into the default branch", async () => {
    // GitHub makes no closing reference for a PR into a non-default branch, so
    // the ticket comes from the branch name; it is done when the batch lands.
    const data = await collect(
      fakeGitHub(
        [201],
        [
          { number: 301, head: "spec-201-a", base: "integration/2026-10-05", mergedAfter: 10 },
          { number: 310, head: "integration/2026-10-05", mergedAfter: 40 },
        ],
      ),
    );

    assert.equal(data.tickets, 1);
    assert.equal(data.pullRequests, 1);
    assert.equal(data.integrationPullRequests, 1);
    assert.deepEqual(leadTimes(data), { p50Hours: 40, p90Hours: 40 });
  });

  it("does not deliver ticket PRs merged into a batch that never reached the default branch", async () => {
    const data = await collect(
      fakeGitHub([201], [{ number: 301, head: "spec-201-a", base: "integration/2026-10-05", mergedAfter: 10 }]),
    );

    assert.equal(data.tickets, 0);
    assert.equal(data.pullRequests, 0);
  });

  it("recognises integration branches by the prefixes in the repo's config", async () => {
    const github = fakeGitHub([], [{ number: 310, head: "batch/06-sync-perf", mergedAfter: 10 }]);

    assert.equal((await collect(github)).tickets, 1);
    const data = await collect(github, { integrationBranchPrefix: ["integration/", "batch/"] });
    assert.equal(data.tickets, 0);
    assert.equal(data.integrationPullRequests, 1);
  });
});

describe("exclusions", () => {
  // As GitHub's GraphQL API returns a Dependabot PR: login `dependabot`, a Bot.
  const dependabot = {
    number: 320,
    head: "dependabot/npm_and_yarn/vite-7.1.11",
    mergedAfter: 30,
    commits: ["Bump vite from 7.1.10 to 7.1.11"],
    author: { login: "dependabot", __typename: "Bot" },
  };
  const github = fakeGitHub([201], [{ number: 301, head: "spec-201-a", mergedAfter: 10 }, dependabot]);

  it("counts a Dependabot PR as a ticket unless the config excludes it", async () => {
    const data = await collect(github);

    assert.equal(data.tickets, 2);
    assert.equal(data.pullRequests, 2);
  });

  for (const [what, exclude] of [
    ["author (as REST names it)", { authors: ["dependabot[bot]"] }],
    ["author (as GraphQL names it)", { authors: ["Dependabot"] }],
    ["branch prefix", { branches: ["dependabot/"] }],
  ] as const) {
    it(`drops a PR excluded by ${what} from every metric`, async () => {
      const data = await collect(github, { exclude });

      assert.equal(data.tickets, 1);
      assert.equal(data.pullRequests, 1);
      assert.deepEqual(throughputWeek(data), [{ week: "2026-10-05", tickets: 1, pullRequests: 1 }]);
      assert.deepEqual(leadTimes(data), { p50Hours: 10, p90Hours: 10 });
      assert.deepEqual(data.metrics["leadTime"]?.coverage, { tickets: 1, of: 1 });
    });
  }

  it("does not deliver an issue that only an excluded PR closes", async () => {
    const data = await collect(
      fakeGitHub([201], [{ number: 301, head: "renovate/eslint", mergedAfter: 10, closes: [201] }]),
      { exclude: { branches: ["renovate/"] } },
    );

    assert.equal(data.tickets, 0);
  });
});
