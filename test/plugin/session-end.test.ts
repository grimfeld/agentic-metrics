import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dirname, "../../plugin/hooks/session-end.ts");
const FIXTURES = join(import.meta.dirname, "../fixtures/transcripts");
const SESSION = "c99b81f0-41dc-44b4-a9a8-c038d6ad0bd9";
const AGENT = "agent-a9b288b9355439561";
const PROJECT = "-Users-dev-repos-jellyfin-comics-reader";

let root: string;
let projectDir: string;
let cache: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "am-session-end-"));
  projectDir = join(root, "projects", PROJECT);
  cpSync(FIXTURES, projectDir, { recursive: true });
  cache = join(root, "cache");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function runHook(stdin: string, env: Record<string, string> = { AGENTIC_METRICS_CACHE_DIR: cache }) {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd: root,
    input: stdin,
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", ...env },
  });
  return { status: result.status, stdout: result.stdout };
}

function sessionEndEvent(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: SESSION,
    transcript_path: join(projectDir, `${SESSION}.jsonl`),
    cwd: "/Users/dev/repos/jellyfin-comics-reader",
    hook_event_name: "SessionEnd",
    reason: "other",
    ...overrides,
  });
}

describe("SessionEnd hook", () => {
  it("copies the full session transcript into the cache, keyed by project and session", () => {
    const { status, stdout } = runHook(sessionEndEvent());

    assert.equal(status, 0);
    assert.equal(stdout, "");
    assert.equal(
      readFileSync(join(cache, PROJECT, `${SESSION}.jsonl`), "utf8"),
      readFileSync(join(FIXTURES, `${SESSION}.jsonl`), "utf8"),
    );
  });

  it("copies the session's sub-agent transcripts and their metadata", () => {
    runHook(sessionEndEvent());

    for (const file of [`${AGENT}.jsonl`, `${AGENT}.meta.json`]) {
      assert.equal(
        readFileSync(join(cache, PROJECT, SESSION, "subagents", file), "utf8"),
        readFileSync(join(FIXTURES, SESSION, "subagents", file), "utf8"),
      );
    }
  });

  it("overwrites the cached copy when the same session ends again", () => {
    runHook(sessionEndEvent());
    const resumedLine = '{"type":"user","sessionId":"' + SESSION + '"}\n';
    appendFileSync(join(projectDir, `${SESSION}.jsonl`), resumedLine);
    appendFileSync(join(projectDir, SESSION, "subagents", `${AGENT}.jsonl`), resumedLine);

    const { status } = runHook(sessionEndEvent({ reason: "clear" }));

    assert.equal(status, 0);
    assert.ok(readFileSync(join(cache, PROJECT, `${SESSION}.jsonl`), "utf8").endsWith(resumedLine));
    assert.ok(
      readFileSync(join(cache, PROJECT, SESSION, "subagents", `${AGENT}.jsonl`), "utf8").endsWith(resumedLine),
    );
  });

  describe("never fails the session end", () => {
    it("exits successfully and caches nothing when the transcript is missing", () => {
      const { status, stdout } = runHook(
        sessionEndEvent({ transcript_path: join(projectDir, "missing.jsonl") }),
      );

      assert.equal(status, 0);
      assert.equal(stdout, "");
      assert.equal(existsSync(join(cache, PROJECT, `${SESSION}.jsonl`)), false);
    });

    it("exits successfully when the cache folder can't be written", () => {
      writeFileSync(cache, "a file where the cache folder should be");

      const { status, stdout } = runHook(sessionEndEvent());

      assert.equal(status, 0);
      assert.equal(stdout, "");
    });

    it("exits successfully when the event isn't valid JSON", () => {
      const { status, stdout } = runHook("not json");

      assert.equal(status, 0);
      assert.equal(stdout, "");
    });
  });

  it("keys the session by its transcript file, so an odd session_id can't write outside the cache", () => {
    runHook(sessionEndEvent({ session_id: "../../escaped" }));

    assert.ok(existsSync(join(cache, PROJECT, SESSION, "subagents", `${AGENT}.jsonl`)));
    assert.ok(existsSync(join(cache, PROJECT, `${SESSION}.jsonl`)));
    assert.equal(existsSync(join(root, "escaped.jsonl")), false);
  });

  it("caches under ~/.cache/agentic-metrics when no override is set", () => {
    const home = join(root, "home");

    runHook(sessionEndEvent(), { HOME: home });

    assert.ok(existsSync(join(home, ".cache", "agentic-metrics", PROJECT, `${SESSION}.jsonl`)));
  });
});

describe("SessionEnd hook, in a clone of a GitHub repo", () => {
  function clone(path: string, remote: string) {
    spawnSync("git", ["init", "-q", path]);
    spawnSync("git", ["-C", path, "remote", "add", "origin", remote]);
    return path;
  }

  it("caches under the repo's GitHub name, so two clones at different paths share one folder", () => {
    const a = clone(join(root, "laptop", "reader"), "git@github.com:Dev/Jellyfin-Comics-Reader.git");
    const b = clone(join(root, "elsewhere", "jcr"), "https://github.com/dev/jellyfin-comics-reader");
    assert.equal(runHook(sessionEndEvent({ cwd: a })).status, 0);
    assert.equal(runHook(sessionEndEvent({ cwd: b, transcript_path: join(projectDir, `${SESSION}.jsonl`) })).status, 0);

    const folder = join(cache, "repos", "dev", "jellyfin-comics-reader");
    assert.ok(existsSync(join(folder, `${SESSION}.jsonl`)));
    assert.ok(existsSync(join(folder, SESSION, "subagents")));
    assert.equal(existsSync(join(cache, PROJECT)), false);
  });

  it("caches under the project folder as before when the clone has no GitHub remote", () => {
    const local = clone(join(root, "plain"), "https://gitlab.com/dev/reader.git");
    assert.equal(runHook(sessionEndEvent({ cwd: local })).status, 0);

    assert.ok(existsSync(join(cache, PROJECT, `${SESSION}.jsonl`)));
    assert.equal(existsSync(join(cache, "repos")), false);
  });
});
