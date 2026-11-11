// SessionEnd hook: copy the session's full transcript, and its sub-agent
// transcripts, into the local cache before Claude Code's cleanup deletes them.
//
// Claude Code layout:  ~/.claude/projects/<project>/<session>.jsonl
//                      ~/.claude/projects/<project>/<session>/subagents/**
// Cache layout:        <cache>/repos/<owner>/<name>/<session>.jsonl
//                      <cache>/repos/<owner>/<name>/<session>/subagents/**
//
// <owner>/<name> is the GitHub repo the session's folder is a clone of (its
// `origin` remote, lower-cased), so every clone of a repo, on any device and
// in any worktree, caches into the same folder: a cache folder synced between
// devices then collects them all. A folder that is no clone of a GitHub repo
// falls back to Claude Code's own project folder name, `<cache>/<project>/`.
//
// It only copies: no network, no parsing of the transcript. Claude Code gives
// SessionEnd hooks 1.5 s in total, and this hook must never fail the session
// end, so every error is reported on stderr and the exit code stays 0.
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

function cacheRoot(): string {
  return process.env["AGENTIC_METRICS_CACHE_DIR"] || join(homedir(), ".cache", "agentic-metrics");
}

/** `owner/name` of the GitHub repo the folder is a clone of, lower-cased; undefined when it is none. */
function githubRepo(cwd: unknown): string[] | undefined {
  if (typeof cwd !== "string") return undefined;
  try {
    const url = execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], { encoding: "utf8", timeout: 500, stdio: ["ignore", "pipe", "ignore"] });
    const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
    return match?.[1] && match[2] ? [match[1].toLowerCase(), match[2].toLowerCase()] : undefined;
  } catch {
    return undefined;
  }
}

function cacheTranscript(event: unknown): void {
  const { transcript_path: transcript, cwd } = (event ?? {}) as { transcript_path?: unknown; cwd?: unknown };
  if (typeof transcript !== "string" || !existsSync(transcript)) return;

  // Keyed by the transcript's own location rather than the event's session_id:
  // that is where the sub-agents live, and basename() keeps writes in the cache.
  const session = basename(transcript, ".jsonl");
  const repo = githubRepo(cwd);
  const projectCache = repo ? join(cacheRoot(), "repos", ...repo.map((part) => basename(part))) : join(cacheRoot(), basename(dirname(transcript)));
  mkdirSync(projectCache, { recursive: true });
  copyFileSync(transcript, join(projectCache, `${session}.jsonl`));

  const subagents = join(dirname(transcript), session, "subagents");
  if (existsSync(subagents)) {
    cpSync(subagents, join(projectCache, session, "subagents"), { recursive: true });
  }
}

try {
  cacheTranscript(JSON.parse(readFileSync(0, "utf8")));
} catch (error) {
  process.stderr.write(`agentic-metrics: transcript not cached: ${String(error)}\n`);
}
