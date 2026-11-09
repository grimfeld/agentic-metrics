// The transcript source: the CLI's swappable boundary to Claude Code's
// transcripts, as the plugin's SessionEnd hook caches them:
//
//   <cache>/<project>/<session>.jsonl                      a session
//   <cache>/<project>/<session>/subagents/**/agent-<id>.jsonl   its sub-agents
//
// <project> is Claude Code's name for the folder the session started in: its
// path with every character other than a letter or digit replaced by `-`. A
// repo's sessions are those of its clone's folder and of the worktrees under
// it (`<clone>/.claude/worktrees/<name>`).
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

/** The transcripts of the clone at `repoDir`, read from the cache at `dir`. */
export function transcriptCache(options: { dir: string; repoDir: string }): TranscriptSource {
  return {
    async read() {
      const repoDir = await realpath(options.repoDir).catch(() => options.repoDir);
      const keys = new Set([projectKey(options.repoDir), projectKey(repoDir)]);
      const ours = (project: string) => [...keys].some((key) => project === key || project.startsWith(`${key}--claude-worktrees-`));

      const projects = await readdir(options.dir, { withFileTypes: true }).catch(() => []);
      const files: TranscriptFile[] = [];
      for (const project of projects) {
        if (!project.isDirectory() || !ours(project.name)) continue;
        const projectDir = join(options.dir, project.name);
        const paths = (await readdir(projectDir, { recursive: true })).filter((path) => path.endsWith(".jsonl")).sort();
        for (const path of paths) {
          const file = transcriptFile(path);
          if (file) files.push({ ...file, lines: parseLines(await readFile(join(projectDir, path), "utf8")) });
        }
      }
      return files;
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
