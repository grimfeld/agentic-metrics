// `agentic-metrics import-transcripts`: brings the transcripts of another
// device into this one's transcript cache, so that `collect` reads them.
//
// Claude Code names a project's transcript folder after the clone's path
// (`-Users-dev-repos-lifeline`), and `collect` reads the folders named after
// the local clone. The same repo cloned elsewhere, on another device, has
// another name: its folders are copied here under the local clone's.
//
// The source is a folder of project folders, as copied from the other device:
// its `~/.cache/agentic-metrics` (where the plugin caches transcripts) or its
// `~/.claude/projects` (where Claude Code keeps them until its cleanup). A
// cache that already holds the repo under its GitHub name
// (`repos/<owner>/<name>/`) is taken as it is.
//
// When the local clone is a clone of a GitHub repo, transcripts are copied to
// the cache's folder for that repo (`source.ts`); otherwise under the local
// clone's project folder name, as Claude Code names it.
import { existsSync, statSync } from "node:fs";
import { cp, mkdir, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { projectKey, repoCacheDir } from "./source.ts";

const WORKTREES = "--claude-worktrees-";

export interface ImportOptions {
  /** The folder of project folders copied from the other device. */
  source: string;
  /** The local clone the transcripts are for. */
  checkout: string;
  /** The GitHub repo (`owner/name`) the local clone is a clone of, if any. */
  repo?: string | undefined;
  /** This device's transcript cache. */
  cacheDir: string;
  /** What the clone's folder is called on the other device; the local clone's name when empty. */
  names: string[];
  /** Report what would be copied, and copy nothing. */
  dryRun: boolean;
}

/** Copies the other device's transcripts of the repo into the cache; returns the lines to report. */
export async function importTranscripts(options: ImportOptions): Promise<string[]> {
  if (!existsSync(options.source) || !statSync(options.source).isDirectory()) throw new Error(`${options.source} is not a folder`);
  const checkout = await realpath(options.checkout).catch(() => options.checkout);
  const localKey = projectKey(checkout);
  const names = (options.names.length > 0 ? options.names : [basename(checkout)]).map((name) => projectKey(name));

  // A project folder is the repo's when its name ends with the clone's folder name; a worktree of it carries the suffix.
  // Under the repo's GitHub name, every project folder's sessions go to one folder: session ids are unique.
  const target = (project: string): string | undefined => {
    const [clone = "", worktree] = project.split(WORKTREES, 2);
    if (!names.some((name) => clone === name || clone.endsWith(`-${name}`))) return undefined;
    if (options.repo) return repoCacheDir(".", options.repo);
    return worktree === undefined ? localKey : `${localKey}${WORKTREES}${worktree}`;
  };

  const projects = (await readdir(options.source, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const matched = projects.flatMap((project) => {
    const to = target(project);
    return to === undefined ? [] : [{ project, to }];
  });
  // The other device's cache may already hold the repo under its GitHub name.
  if (options.repo) {
    const named = repoCacheDir(".", options.repo);
    if (existsSync(join(options.source, named))) matched.unshift({ project: named, to: named });
  }
  if (matched.length === 0) {
    const found = projects.length > 0 ? `Project folders found: ${projects.join(", ")}.` : "It holds no project folder.";
    throw new Error(
      `no project folder in ${options.source} is named after ${names.map((name) => `"${name}"`).join(" or ")}. ${found} Pass --name <the clone's folder name on that device>.`,
    );
  }

  const lines: string[] = [];
  let copied = 0;
  let kept = 0;
  for (const { project, to } of matched) {
    const from = join(options.source, project);
    const transcripts = (await readdir(from, { recursive: true })).filter((path) => path.endsWith(".jsonl")).sort();
    let here = 0;
    for (const path of transcripts) {
      const destination = join(options.cacheDir, to, path);
      // A transcript already here stays, unless the other device's is longer: a session resumed there.
      if (existsSync(destination) && statSync(destination).size >= statSync(join(from, path)).size) {
        kept++;
        continue;
      }
      if (!options.dryRun) {
        await mkdir(dirname(destination), { recursive: true });
        await cp(join(from, path), destination);
      }
      here++;
    }
    copied += here;
    lines.push(`${project}: ${String(here)} of ${String(transcripts.length)} transcripts ${options.dryRun ? "to copy" : "copied"} -> ${join(options.cacheDir, to)}`);
  }
  lines.push(
    `${String(copied)} transcripts ${options.dryRun ? "would be imported" : "imported"}, ${String(kept)} already here. ${options.dryRun ? "Nothing was copied (--dry-run)." : "Run collect again to read them."}`,
  );
  return lines;
}
