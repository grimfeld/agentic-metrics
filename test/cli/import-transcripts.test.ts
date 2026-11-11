import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";
import { projectKey, transcriptCache } from "../../cli/transcripts/source.ts";

// The transcript cache fixture stands for another device, where the repo is
// cloned at /Users/dev/repos/lifeline (`transcripts.test.ts` describes its
// sessions). Here the clone is somewhere else, so its folders have other names.
const OTHER_DEVICE = join(import.meta.dirname, "../fixtures/transcript-cache/lifeline");
const GITHUB = join(import.meta.dirname, "../fixtures/github/lifeline");
const NOW = new Date("2026-11-09T12:00:00Z");

let root: string;
let clone: string;
let cache: string;
let source: string;
let stdout: string;
let stderr: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "am-import-")));
  clone = join(root, "work", "lifeline");
  cache = join(root, "cache");
  source = join(root, "from-laptop");
  mkdirSync(clone, { recursive: true });
  cpSync(OTHER_DEVICE, source, { recursive: true });
  stdout = "";
  stderr = "";
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function run(argv: string[], cwd = clone): Promise<number> {
  stdout = "";
  stderr = "";
  return main(argv, {
    cwd,
    cacheDir: cache,
    github: fixtureSource(GITHUB),
    transcripts: transcriptCache({ dir: cache, repoDir: clone }),
    now: () => NOW,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
}

const cached = () => (existsSync(cache) ? readdirSync(cache).sort() : []);
const transcriptsIn = (dir: string) => readdirSync(dir, { recursive: true }).filter((path) => String(path).endsWith(".jsonl")).length;

describe("import-transcripts", () => {
  it("copies the other device's folders of the repo under the local clone's name, worktrees and sub-agents included", async () => {
    assert.equal(await run(["import-transcripts", source]), 0, stderr);

    const key = projectKey(clone);
    assert.deepEqual(cached(), [key, `${key}--claude-worktrees-ticket-137`]);
    // Every transcript of the repo, and none of the other clone's the fixture also holds.
    const theirs = readdirSync(source).filter((project) => /-lifeline(--claude-worktrees-.*)?$/.test(project));
    assert.equal(transcriptsIn(cache), theirs.reduce((sum, project) => sum + transcriptsIn(join(source, project)), 0));
    assert.ok(readdirSync(join(cache, key), { recursive: true }).some((path) => /subagents[/\\]agent-.*\.jsonl$/.test(String(path))));
    assert.match(stdout, /-Users-dev-repos-lifeline: \d+ of \d+ transcripts copied -> /);
    assert.match(stdout, /transcripts imported, 0 already here\. Run collect again to read them\./);
  });

  it("makes collect read them: the same human messages as on the device they came from", async () => {
    await run(["import-transcripts", source]);
    assert.equal(await run(["collect"]), 0, stderr);

    const dataset = JSON.parse(readFileSync(join(clone, "datasets/grimfeld/lifeline.json"), "utf8")) as { metrics: Record<string, { value: { p50: number; mean: number }; coverage: unknown }> };
    const messages = dataset.metrics["humanMessagesPerTicket"];
    assert.ok(messages);
    assert.deepEqual(messages.coverage, { tickets: 4, of: 5 });
    assert.deepEqual({ p50: messages.value.p50, mean: messages.value.mean }, { p50: 2, mean: 2.3 });
  });

  it("takes the clone's folder name on the other device from --name, and the local clone from --checkout", async () => {
    renameSync(join(source, "-Users-dev-repos-lifeline"), join(source, "-home-dev-code-life"));
    rmSync(join(source, "-Users-dev-repos-lifeline--claude-worktrees-ticket-137"), { recursive: true });

    assert.equal(await run(["import-transcripts", source, "--checkout", clone, "--name", "life"], root), 0, stderr);
    assert.deepEqual(cached(), [projectKey(clone)]);
  });

  it("names the project folders it found when none is the repo's, and copies nothing", async () => {
    renameSync(join(source, "-Users-dev-repos-lifeline"), join(source, "-home-dev-code-life"));
    rmSync(join(source, "-Users-dev-repos-lifeline--claude-worktrees-ticket-137"), { recursive: true });

    assert.equal(await run(["import-transcripts", source]), 1);
    assert.match(stderr, /no project folder in .* is named after "lifeline"\. Project folders found: .*-home-dev-code-life.*Pass --name/);
    assert.deepEqual(cached(), []);
  });

  it("keeps a transcript already here, unless the other device's is longer", async () => {
    await run(["import-transcripts", source]);
    assert.equal(await run(["import-transcripts", source]), 0, stderr);
    assert.match(stdout, /^0 transcripts imported, \d+ already here\./m);

    // The session was resumed on the other device: its transcript grew.
    const project = join(source, "-Users-dev-repos-lifeline");
    const [session] = readdirSync(project).filter((name) => name.endsWith(".jsonl"));
    assert.ok(session);
    appendFileSync(join(project, session), '{"type":"assistant","timestamp":"2026-10-19T10:00:00Z"}\n');
    assert.equal(await run(["import-transcripts", source]), 0, stderr);

    assert.match(stdout, /^1 transcripts imported, /m);
    assert.equal(readFileSync(join(cache, projectKey(clone), session), "utf8"), readFileSync(join(project, session), "utf8"));
  });

  it("lists what it would copy with --dry-run, and copies nothing", async () => {
    assert.equal(await run(["import-transcripts", source, "--dry-run"]), 0, stderr);

    assert.match(stdout, /transcripts to copy -> /);
    assert.match(stdout, /Nothing was copied \(--dry-run\)\./);
    assert.deepEqual(cached(), []);
  });

  it("refuses a source that is not a folder", async () => {
    assert.equal(await run(["import-transcripts", join(root, "nowhere")]), 1);
    assert.match(stderr, /is not a folder/);
    assert.equal(await run(["import-transcripts"]), 1);
    assert.match(stderr, /takes one folder/);
  });
});

describe("the cache under the repo's GitHub name", () => {
  /** The dataset's human messages and sub-agents, read from `cache` for a clone at `repoDir`. */
  async function figures(repoDir: string, repo?: string) {
    const out = join(root, "out");
    rmSync(out, { recursive: true, force: true });
    const status = await main(["collect", "--datasets", out], {
      cwd: clone,
      github: fixtureSource(GITHUB),
      transcripts: transcriptCache({ dir: cache, repoDir, repo }),
      now: () => NOW,
      stdout: () => {},
    });
    assert.equal(status, 0);
    const dataset = JSON.parse(readFileSync(join(out, "grimfeld/lifeline.json"), "utf8")) as { metrics: Record<string, unknown> };
    return { messages: dataset.metrics["humanMessagesPerTicket"], agents: dataset.metrics["subAgents"] };
  }

  /** The other device's project folders of the clone at /Users/dev/repos/lifeline (`-old` is another clone). */
  const OURS = ["-Users-dev-repos-lifeline", "-Users-dev-repos-lifeline--claude-worktrees-ticket-137"];
  const ourTranscripts = () => OURS.reduce((total, project) => total + transcriptsIn(join(OTHER_DEVICE, project)), 0);

  /** Those sessions, flattened into `<cache>/repos/grimfeld/lifeline` as the plugin caches them. */
  function cacheByRepo(into = cache) {
    for (const project of OURS) cpSync(join(OTHER_DEVICE, project), join(into, "repos", "grimfeld", "lifeline"), { recursive: true });
  }

  it("is read for any clone's path, as the project folders are for theirs", async () => {
    cpSync(OTHER_DEVICE, cache, { recursive: true });
    const byProject = await figures("/Users/dev/repos/lifeline");
    rmSync(cache, { recursive: true });
    cacheByRepo();

    assert.deepEqual(await figures(clone, "Grimfeld/Lifeline"), byProject);
  });

  it("counts a transcript cached in both layouts once", async () => {
    cpSync(OTHER_DEVICE, cache, { recursive: true });
    const once = await figures("/Users/dev/repos/lifeline");
    cacheByRepo();

    assert.deepEqual(await figures("/Users/dev/repos/lifeline", "grimfeld/lifeline"), once);
  });

  it("is where import-transcripts copies to when the clone is a clone of a GitHub repo", async () => {
    const status = await main(["import-transcripts", source], { cwd: clone, cacheDir: cache, localRepo: () => Promise.resolve("grimfeld/lifeline"), stdout: () => {} });

    assert.equal(status, 0);
    assert.deepEqual(cached(), ["repos"]);
    assert.equal(transcriptsIn(join(cache, "repos/grimfeld/lifeline")), ourTranscripts());
  });

  it("is taken as it is from another device's cache that already uses it", async () => {
    rmSync(source, { recursive: true });
    cacheByRepo(source);
    const status = await main(["import-transcripts", source], { cwd: clone, cacheDir: cache, localRepo: () => Promise.resolve("grimfeld/lifeline"), stdout: () => {} });

    assert.equal(status, 0);
    assert.equal(transcriptsIn(join(cache, "repos/grimfeld/lifeline")), ourTranscripts());
  });
});
