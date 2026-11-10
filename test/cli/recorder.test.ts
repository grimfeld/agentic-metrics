import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addTrailer } from "../../cli/recorder.mjs";

const RECORDER = join(import.meta.dirname, "../../cli/recorder.mjs");
const SESSION = "7a63028a-8016-5e56-9126-f53d22b0bd7d";
const T = 'Session-Record: v1 k=abc active=1 human=0 agents=0 started=2026-11-10T18:00:00Z';

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "am-recorder-"));
  mkdirSync(join(repo, ".git"));
});

afterEach(() => {
  chmodSync(repo, 0o755);
  rmSync(repo, { recursive: true, force: true });
});

/** `HH:MM` on the test day, as the recorder's clock. */
function at(time: string): string {
  return `2026-11-10T${time}:00Z`;
}

/** Runs the recorder on one hook event at `time`; returns what it printed. */
function hook(time: string, event: Record<string, unknown>, env: Record<string, string> = {}): string {
  const result = spawnSync("node", [RECORDER], {
    input: JSON.stringify({ session_id: SESSION, cwd: repo, ...event }),
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", CLAUDE_PROJECT_DIR: repo, AGENTIC_METRICS_NOW: at(time), ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout;
}

const prompt = (text: string) => ({ hook_event_name: "UserPromptSubmit", prompt: text });
const tool = (name = "Read") => ({ hook_event_name: "PostToolUse", tool_name: name, tool_input: {} });
const bash = (command: string, extra: Record<string, unknown> = {}) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command, description: "Commit" }, ...extra });

/** The command the recorder rewrote `command` to, or undefined when it left it alone. */
function rewritten(time: string, command: string, extra: Record<string, unknown> = {}): { command: string; description: string } | undefined {
  const out = hook(time, bash(command, extra));
  if (out === "") return undefined;
  const parsed = JSON.parse(out) as { hookSpecificOutput: { hookEventName: string; permissionDecision?: string; updatedInput: { command: string; description: string } } };
  assert.equal(parsed.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(parsed.hookSpecificOutput.permissionDecision, undefined, "the recorder grants nothing");
  return parsed.hookSpecificOutput.updatedInput;
}

const record = (command: string | undefined) => /Session-Record: (v1 k=([0-9a-f]{12}) active=(\d+) human=(\d+) agents=(\d+) started=(\S+?)(?: parent=([0-9a-f]{12}))?)"/.exec(command ?? "");

describe("recorder: counters", () => {
  it("records a session's human messages, active time and start on the commit it makes", () => {
    hook("18:00", prompt("Implement the ticket"));
    hook("18:03", tool());
    hook("18:06", tool());
    hook("18:08", prompt("Also handle the empty case"));
    hook("18:10", tool());
    const out = rewritten("18:10", 'git commit -m "Handle the empty case"');

    assert.ok(out);
    assert.equal(out.command, `git commit --trailer "Session-Record: ${record(out.command)?.[1] ?? ""}" -m "Handle the empty case"`);
    const [, , , active, human, agents, started] = record(out.command) ?? [];
    assert.deepEqual({ active, human, agents, started }, { active: "600", human: "2", agents: "0", started: "2026-11-10T18:00:00Z" });
    assert.equal(out.description, "Commit", "the rest of the tool input is kept");
  });

  it("counts a gap of more than 5 minutes between events as 5 minutes: the rest is idle", () => {
    hook("18:00", prompt("Start"));
    hook("18:02", tool());
    // Back the next morning.
    hook("23:00", prompt("Continue"));
    hook("23:01", tool());

    assert.equal(record(rewritten("23:01", "git commit -m x")?.command)?.[3], String((2 + 5 + 1) * 60));
  });

  it("does not count slash commands, shell escapes or text the tooling wrote as human messages", () => {
    hook("18:00", prompt("/grill-with-docs the plan"));
    hook("18:01", prompt("!git status"));
    hook("18:02", prompt('<agent-message from="a73f">done</agent-message>'));
    hook("18:03", prompt("<task-notification>finished</task-notification>"));
    hook("18:04", prompt("   "));
    hook("18:05", prompt("Yes to all"));

    assert.equal(record(rewritten("18:05", "git commit -m x")?.command)?.[4], "1");
  });

  it("gives a sub-agent counters and a key of its own, its parent's key, and no human message", () => {
    hook("18:00", prompt("Run the batch"));
    const agent = { agent_id: "a73fdf5388faeeebe", agent_type: "general-purpose" };
    hook("18:10", { ...tool(), ...agent });
    hook("18:14", { ...tool(), ...agent });
    const child = record(rewritten("18:14", "git commit -m x", agent)?.command);
    const parent = record(rewritten("18:15", 'git merge --no-ff ticket-2 -m "Merge ticket-2: Plugin (#2)"')?.command);

    assert.ok(child && parent);
    assert.notEqual(child[2], parent[2]);
    assert.equal(child[7], parent[2], "the sub-agent names its parent");
    assert.deepEqual({ active: child[3], human: child[4], agents: child[5], started: child[6] }, { active: "240", human: "0", agents: "0", started: "2026-11-10T18:10:00Z" });
    // The parent spawned one sub-agent, and its own time does not include the sub-agent's.
    assert.deepEqual({ active: parent[3], human: parent[4], agents: parent[5], parent: parent[7] }, { active: "300", human: "1", agents: "1", parent: undefined });
  });

  it("writes no session id, path or prompt text: the key is a hash, and state stays under .git", () => {
    hook("18:00", prompt("A secret plan about payroll"));
    const out = hook("18:01", bash('git commit -m "x"'));

    assert.doesNotMatch(out, new RegExp(SESSION));
    assert.doesNotMatch(out, /payroll/);
    assert.doesNotMatch(out.replace(/"description":"[^"]*"/, ""), new RegExp(repo.replace(/[/\\]/g, "[/\\\\]")));
    assert.deepEqual(readdirSync(repo), [".git"]);
    const [state] = readdirSync(join(repo, ".git/agentic-metrics"));
    assert.match(state ?? "", /^[0-9a-f]{12}\.json$/);
    assert.doesNotMatch(readFileSync(join(repo, ".git/agentic-metrics", state ?? ""), "utf8"), /payroll|7a63028a/);
  });

  it("keeps a worktree's state in the repo's own .git", () => {
    const worktree = join(repo, "wt");
    mkdirSync(join(repo, ".git/worktrees/wt"), { recursive: true });
    writeFileSync(join(repo, ".git/worktrees/wt/commondir"), "../..\n");
    mkdirSync(worktree);
    writeFileSync(join(worktree, ".git"), `gitdir: ${join(repo, ".git/worktrees/wt")}\n`);
    hook("18:00", prompt("Start"), { CLAUDE_PROJECT_DIR: worktree });

    assert.equal(readdirSync(join(repo, ".git/agentic-metrics")).length, 1);
  });
});

describe("recorder: never in the way", () => {
  it("leaves a command with no commit alone", () => {
    hook("18:00", prompt("Start"));
    for (const command of ["npm test", "git status && git log -1", "git commit-tree abc", "git merge --abort", "git merge ticket-2"]) {
      assert.equal(hook("18:01", bash(command)), "", command);
    }
  });

  it("does nothing, and exits 0, on an event it cannot read or outside a git repo", () => {
    for (const input of ["", "not json", "null", "[]", '{"hook_event_name":"PreToolUse"}']) {
      const result = spawnSync("node", [RECORDER], { input, encoding: "utf8", env: { PATH: process.env["PATH"] ?? "", CLAUDE_PROJECT_DIR: repo } });
      assert.deepEqual({ status: result.status, stdout: result.stdout, stderr: result.stderr }, { status: 0, stdout: "", stderr: "" }, input);
    }
    rmSync(join(repo, ".git"), { recursive: true });
    assert.equal(hook("18:00", bash('git commit -m "x"')), "");
    assert.equal(existsSync(join(repo, ".git")), false);
  });

  it("leaves the commit untouched when it cannot write its state", () => {
    chmodSync(join(repo, ".git"), 0o555);
    try {
      // Root ignores permissions: only meaningful when the folder really is read-only.
      if (process.getuid?.() !== 0) assert.equal(hook("18:00", bash('git commit -m "x"')), "");
    } finally {
      chmodSync(join(repo, ".git"), 0o755);
    }
  });

  it("does not add a second record to a command that already carries one", () => {
    hook("18:00", prompt("Start"));
    assert.equal(hook("18:01", bash(`git commit --trailer "${T}" -m x`)), "");
  });
});

describe("recorder: rewriting the command", () => {
  const cases: [name: string, command: string, expected: string][] = [
    ["a plain commit", 'git commit -m "Fix"', `git commit --trailer "${T}" -m "Fix"`],
    ["a commit after other commands", 'cd app && git add -A && git commit -q -m "Fix" && git push', `cd app && git add -A && git commit --trailer "${T}" -q -m "Fix" && git push`],
    ["git -C and -c options", "git -C app -c user.name=x commit -m Fix", `git -C app -c user.name=x commit --trailer "${T}" -m Fix`],
    ["a variable set before git", "GIT_AUTHOR_DATE=now git commit -m Fix", `GIT_AUTHOR_DATE=now git commit --trailer "${T}" -m Fix`],
    ["two commits", "git commit -m a; git commit -m b", `git commit --trailer "${T}" -m a; git commit --trailer "${T}" -m b`],
    ["a commit in a subshell, piped", "(git commit -m a) | tail -1", `(git commit --trailer "${T}" -m a) | tail -1`],
    [
      "a message from a heredoc",
      "git commit -m \"$(cat <<'EOF'\nFix the hook\n\ngit commit is rewritten here\nEOF\n)\" && git push",
      `git commit --trailer "${T}" -m "$(cat <<'EOF'\nFix the hook\n\ngit commit is rewritten here\nEOF\n)" && git push`,
    ],
    ["a merge with a message", 'git merge --no-ff ticket-2 -m "Merge ticket-2: Plugin (#2)" 2>&1 | tail -1', `git merge --no-ff ticket-2 -m "Merge ticket-2: Plugin (#2)" 2>&1 -m "${T}" | tail -1`],
    ["a merge then a push", 'git merge ticket-2 --message="Merge ticket-2" && git push', `git merge ticket-2 --message="Merge ticket-2" -m "${T}" && git push`],
  ];
  for (const [name, command, expected] of cases) {
    it(`adds the record to ${name}`, () => {
      assert.equal(addTrailer(command, T), expected);
    });
  }

  const untouched: [name: string, command: string][] = [
    ["git commit named inside double quotes", 'echo "then run git commit -m x"'],
    ["git commit named inside single quotes", "grep -n 'git commit' README.md"],
    ["a line of a heredoc body that starts with git commit", "cat > notes.md <<EOF\ngit commit -m x\nEOF"],
    ["a quoted message whose line starts with git commit", 'gh pr create --body "Steps:\ngit commit -m x"'],
    ["a merge with no message: adding one would replace git's own", "git merge ticket-2"],
    ["a merge that makes no commit", 'git merge --squash ticket-2 -m "x"'],
    ["other git commands", "git commit-graph write; git committed; git log --merge"],
    ["an unterminated quote", 'git commit -m "oops'],
  ];
  for (const [name, command] of untouched) {
    it(`leaves ${name} alone`, () => {
      assert.equal(addTrailer(command, T), command);
    });
  }
});
