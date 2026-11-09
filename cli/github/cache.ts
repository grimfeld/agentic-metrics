// Incremental collection: a GitHub source that keeps every item it has read in
// a local cache and, once a request has been read in full, asks the source it
// wraps only for the items updated since the last read, merging them by key.
//
// The published dataset holds aggregates only, so the raw items live here, in
// <cache>/github/<owner>/<name>/<request>.json, never in the dataset. A cached
// request is read in full again when its `version` changes (its query changed)
// or when `full` is set.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { INCREMENTAL, type GitHubSource } from "./source.ts";

/**
 * How far before the last read's start the next read begins. GitHub stamps
 * `updatedAt` with its own clock, and the last read started on ours, so the
 * overlap absorbs clock skew. Items read twice are merged by key.
 */
const OVERLAP_MS = 60 * 60 * 1000;

interface CacheFile {
  version: string;
  /** When the read that produced these items started, by our clock. */
  readAt: string;
  items: unknown[];
}

/** The local cache root shared with the plugin's transcript cache. */
export function defaultCacheDir(): string {
  return process.env["AGENTIC_METRICS_CACHE_DIR"] || join(homedir(), ".cache", "agentic-metrics");
}

export function cachedSource(inner: GitHubSource, options: { dir: string; now: () => Date; full: boolean }): GitHubSource {
  let repo: Promise<unknown> | undefined;
  const readRepo = () => (repo ??= inner.read("repo"));

  return {
    async read(request, readOptions) {
      if (request === "repo") return readRepo();
      const incremental = INCREMENTAL[request];
      if (!incremental) return inner.read(request, readOptions);

      const { full_name: fullName } = (await readRepo()) as { full_name: string };
      const path = join(options.dir, "github", ...fullName.toLowerCase().split("/"), `${request}.json`);
      const cached = options.full ? undefined : await load(path, incremental.version);

      const readAt = options.now();
      const pending = (cached?.items ?? []).flatMap((item) => incremental.pendingSince?.(item) ?? []).map(Date.parse);
      const since = cached && new Date(Math.min(new Date(cached.readAt).getTime() - OVERLAP_MS, ...pending));
      const fresh = incremental.items(await inner.read(request, { since }));

      const items = new Map((cached?.items ?? []).map((item) => [incremental.key(item), item]));
      for (const item of fresh) items.set(incremental.key(item), item);
      const merged = [...items.entries()].sort(([a], [b]) => byKey(a, b)).map(([, item]) => item);

      await save(path, { version: incremental.version, readAt: readAt.toISOString(), items: merged });
      return incremental.answer(merged);
    },
  };
}

async function load(path: string, version: string): Promise<CacheFile | undefined> {
  try {
    const file = JSON.parse(await readFile(path, "utf8")) as CacheFile;
    return file.version === version && Array.isArray(file.items) ? file : undefined;
  } catch {
    return undefined; // Missing or unreadable: read in full.
  }
}

async function save(path: string, file: CacheFile): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(file));
  await rename(`${path}.tmp`, path);
}

/** Numeric keys in numeric order, others after them in string order, so merged reads are deterministic. */
function byKey(a: string, b: string): number {
  const [x, y] = [Number(a), Number(b)];
  if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  if (Number.isFinite(x) !== Number.isFinite(y)) return Number.isFinite(x) ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
