// The transcript source: the CLI's swappable boundary to Claude Code's
// transcripts, as the plugin's SessionEnd hook caches them:
//
//   <cache>/repos/<owner>/<name>/<session>.jsonl                      a session
//   <cache>/repos/<owner>/<name>/<session>/subagents/**/agent-<id>.jsonl   its sub-agents
//
// <owner>/<name> is the GitHub repo, lower-cased, whatever the clone's path, so
// that one cache folder synced between devices holds every device's sessions.
//
// Caches written before, and sessions in a folder that is no clone of a GitHub
// repo, use Claude Code's own project folder name instead:
//
//   <cache>/<project>/<session>.jsonl, and its sub-agents likewise
//
// <project> is Claude Code's name for the folder the session started in: its
// path with every character other than a letter or digit replaced by `-`. A
// repo's sessions there are those of its clone's folder and of the worktrees
// under it (`<clone>/.claude/worktrees/<name>`). Both layouts are read; a
// transcript found in both counts once, the longer copy.
//
// The source only reads files and parses their JSON lines. Nothing it returns
// may reach the dataset as is: `load.ts` keeps derived numbers and the few
// fields linking needs (branches, working folders, PR links).
import { readdir, readFile, realpath } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

export interface TranscriptFile {
  /** The session's id: its file name, or the folder holding a sub-agent. */
  session: string;
  /** Set for a sub-agent's transcript. */
  agentId?: string;
  /** Its JSON lines, parsed; unparseable lines are skipped. */
  lines: unknown[];
}

export interface TranscriptSource {
  read(): Promise<TranscriptFile[]>;
}

/** No transcripts: every transcript metric is unknown. */
export const noTranscripts: TranscriptSource = { read: () => Promise.resolve([]) };

/** Claude Code's project folder name for a working folder. */
export function projectKey(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, "-");
}

/** The folder of the cache at `cacheDir` holding the transcripts of the GitHub repo `owner/name`. */
export function repoCacheDir(cacheDir: string, repo: string): string {
  return join(cacheDir, "repos", ...repo.toLowerCase().split("/").map((part) => basename(part)));
}

/**
 * The transcripts of the clone at `repoDir`, read from the cache at `dir`:
 * those cached under its GitHub repo `repo` (when given), and those under the
 * clone's project folders.
 */
export function transcriptCache(options: { dir: string; repoDir: string; repo?: string | undefined }): TranscriptSource {
  return {
    async read() {
      const repoDir = await realpath(options.repoDir).catch(() => options.repoDir);
      const keys = new Set([projectKey(options.repoDir), projectKey(repoDir)]);
      const ours = (project: string) => [...keys].some((key) => project === key || project.startsWith(`${key}--claude-worktrees-`));

      const projects = await readdir(options.dir, { withFileTypes: true }).catch(() => []);
      const folders = projects.filter((project) => project.isDirectory() && ours(project.name)).map((project) => join(options.dir, project.name));
      if (options.repo) folders.unshift(repoCacheDir(options.dir, options.repo));

      // By session and sub-agent: the same transcript cached in both layouts counts once, its longer copy.
      const files = new Map<string, TranscriptFile>();
      for (const folder of folders) {
        const paths = (await readdir(folder, { recursive: true }).catch(() => [] as string[])).filter((path) => path.endsWith(".jsonl")).sort();
        for (const path of paths) {
          const found = transcriptFile(path);
          if (!found) continue;
          const file = { ...found, lines: parseLines(await readFile(join(folder, path), "utf8")) };
          const key = `${file.session}\u0000${file.agentId ?? ""}`;
          const known = files.get(key);
          if (!known || file.lines.length > known.lines.length) files.set(key, file);
        }
      }
      return [...files.values()];
    },
  };
}

/** `<session>.jsonl` or `<session>/subagents/**\/agent-<id>.jsonl`, relative to the project folder; else undefined. */
function transcriptFile(path: string): Omit<TranscriptFile, "lines"> | undefined {
  const parts = relative(".", path).split(sep);
  const name = basename(path, ".jsonl");
  if (parts.length === 1) return { session: name };
  if (parts[1] === "subagents" && name.startsWith("agent-") && parts[0]) return { session: parts[0], agentId: name.slice("agent-".length) };
  return undefined;
}

function parseLines(text: string): unknown[] {
  return text.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      return []; // A line cut short by a crash, or a format we don't know.
    }
  });
}
