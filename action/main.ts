// Thin wrapper around `decide`: reads the event the runner wrote, fetches the
// current PR body or issue comments, and performs the operations with the
// workflow token. Not unit-tested (spec, Testing Decisions #3); keep logic out of here.
import { readFileSync } from "node:fs";
import { branchRegex as compileBranchRegex, DEFAULT_BRANCH_REGEX } from "../cli/branch.ts";
import {
  decide,
  DEFAULT_BUG_LABEL,
  DEFAULT_READY_LABEL,
  type IssueComment,
  type Operation,
} from "./decide.ts";

const api = process.env["GITHUB_API_URL"] ?? "https://api.github.com";
const token = input("github-token");

try {
  await run();
} catch (error) {
  console.log(`::error::${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function run(): Promise<void> {
  const name = requiredEnv("GITHUB_EVENT_NAME");
  const payload = JSON.parse(readFileSync(requiredEnv("GITHUB_EVENT_PATH"), "utf8")) as Record<string, unknown>;
  const pattern = input("branch-regex");
  const branchRegex = pattern ? compileBranchRegex(pattern) : DEFAULT_BRANCH_REGEX;
  const bugLabel = input("bug-label") || DEFAULT_BUG_LABEL;
  const readyLabel = input("ready-label") || DEFAULT_READY_LABEL;

  if (name === "pull_request") await refreshBody(payload);
  const comments = name === "issues" ? await issueComments(payload) : undefined;

  const operations = decide({ name, payload, ...(comments ? { comments } : {}) }, { branchRegex, bugLabel, readyLabel });
  if (operations.length === 0) console.log("agentic-metrics: nothing to do.");
  for (const operation of operations) await perform(operation);
}

// The payload's body can be stale if someone edited the PR since the event
// fired; decide on the current one so a fresh link is never duplicated.
async function refreshBody(payload: Record<string, unknown>): Promise<void> {
  const pr = payload["pull_request"] as { url?: string; body: string | null } | undefined;
  if (!pr?.url) return;
  const fresh = (await request("GET", pr.url)) as { body: string | null };
  pr.body = fresh.body;
}

// Every comment on the issue, so a reminder already posted is never posted again.
async function issueComments(payload: Record<string, unknown>): Promise<IssueComment[]> {
  const issue = payload["issue"] as { comments_url?: string } | undefined;
  if (!issue?.comments_url) return [];
  const comments: IssueComment[] = [];
  for (let page = 1; ; page++) {
    const batch = (await request("GET", `${issue.comments_url}?per_page=100&page=${String(page)}`)) as IssueComment[];
    comments.push(...batch);
    if (batch.length < 100) return comments;
  }
}

async function perform(operation: Operation): Promise<void> {
  const { owner, repo, body } = operation;
  switch (operation.kind) {
    case "update-pr-body": {
      const pullNumber = String(operation.pullNumber);
      await request("PATCH", `${api}/repos/${owner}/${repo}/pulls/${pullNumber}`, { body });
      console.log(`agentic-metrics: linked ${owner}/${repo}#${pullNumber} to its issue.`);
      return;
    }
    case "create-issue-comment": {
      const issueNumber = String(operation.issueNumber);
      await request("POST", `${api}/repos/${owner}/${repo}/issues/${issueNumber}/comments`, { body });
      console.log(`agentic-metrics: commented on ${owner}/${repo}#${issueNumber}.`);
      return;
    }
  }
}

async function request(method: string, url: string, body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`${method} ${url} failed: ${String(response.status)} ${await response.text()}`);
  return response.json();
}

// The runner passes `with:` inputs as INPUT_<NAME>, upper-cased, hyphens kept.
function input(name: string): string {
  return (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; is this running in GitHub Actions?`);
  return value;
}
