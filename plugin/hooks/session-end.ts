// SessionEnd hook: copy the session's full transcript, and its sub-agent
// transcripts, into the local cache before Claude Code's cleanup deletes them.
//
// Claude Code layout:  ~/.claude/projects/<project>/<session>.jsonl
//                      ~/.claude/projects/<project>/<session>/subagents/**
// Cache layout:        <cache>/<project>/<session>.jsonl
//                      <cache>/<project>/<session>/subagents/**
//
// It only copies: no network, no parsing of the transcript. Claude Code gives
// SessionEnd hooks 1.5 s in total, and this hook must never fail the session
// end, so every error is reported on stderr and the exit code stays 0.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

function cacheRoot(): string {
  return process.env["AGENTIC_METRICS_CACHE_DIR"] || join(homedir(), ".cache", "agentic-metrics");
}

function cacheTranscript(event: unknown): void {
  const transcript = (event as { transcript_path?: unknown } | null)?.transcript_path;
  if (typeof transcript !== "string" || !existsSync(transcript)) return;

  // Keyed by the transcript's own location rather than the event's session_id:
  // that is where the sub-agents live, and basename() keeps writes in the cache.
  const session = basename(transcript, ".jsonl");
  const projectCache = join(cacheRoot(), basename(dirname(transcript)));
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
