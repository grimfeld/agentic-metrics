import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dirname, "../../plugin/hooks/pr-link-warning.ts");

let repo: string;

// A real git checkout on the given branch: the hook reads the branch from the event's cwd.
function checkout(branch: string): void {
  const result = spawnSync("git", ["init", "--quiet", "--initial-branch", branch, repo], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "am-pr-link-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function runHook(stdin: string) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: stdin,
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "" },
  });
  return { status: result.status, stdout: result.stdout };
}

// Shaped like a real PreToolUse event for the Bash tool.
function bashEvent(command: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: "c99b81f0-41dc-44b4-a9a8-c038d6ad0bd9",
    transcript_path: "/Users/dev/.claude/projects/-Users-dev-repo/c99b81f0-41dc-44b4-a9a8-c038d6ad0bd9.jsonl",
    cwd: repo,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command, description: "Open the pull request" },
    tool_use_id: "toolu_01AbCdEfGhIjKlMnOpQrStUv",
    ...overrides,
  });
}

function assertWarns(output: { status: number | null; stdout: string }): void {
  assert.equal(output.status, 0);
  const json = JSON.parse(output.stdout) as Record<string, unknown>;
  assert.match(String(json["systemMessage"]), /Closes #N/);
  assert.deepEqual(Object.keys(json["hookSpecificOutput"] as object).sort(), ["additionalContext", "hookEventName"]);
  assert.equal((json["hookSpecificOutput"] as Record<string, unknown>)["hookEventName"], "PreToolUse");
}

function assertSilent(output: { status: number | null; stdout: string }): void {
  assert.equal(output.status, 0);
  assert.equal(output.stdout, "");
}

describe("gh pr create warning hook", () => {
  it("warns, without deciding on the command, when neither the body nor the branch names a ticket", () => {
    checkout("tidy-readme");

    const output = runHook(bashEvent('gh pr create --title "Tidy README" --body "Rewords the intro."'));

    assertWarns(output);
    const json = JSON.parse(output.stdout) as { hookSpecificOutput: { additionalContext: string } };
    assert.match(json.hookSpecificOutput.additionalContext, /tidy-readme/);
    assert.doesNotMatch(output.stdout, /permissionDecision|"decision"|"continue"/);
  });

  describe("is silent when the body closes a ticket", () => {
    for (const body of ["Closes #19", "Rewords the intro. fixes: #7", "Resolved grimfeld/lifeline#376"]) {
      it(`inline: ${JSON.stringify(body)}`, () => {
        checkout("tidy-readme");

        assertSilent(runHook(bashEvent(`gh pr create --title "Tidy README" --body ${JSON.stringify(body)}`)));
      });
    }

    it("in a heredoc body, as agents usually write it", () => {
      checkout("tidy-readme");
      const command = [
        'gh pr create --title "Tidy README" --body "$(cat <<\'EOF\'',
        "## Summary",
        "Rewords the intro.",
        "",
        "Closes #19",
        "EOF",
        ')"',
      ].join("\n");

      assertSilent(runHook(bashEvent(command)));
    });

    it("in a --body-file, read relative to the event's cwd", () => {
      checkout("tidy-readme");
      writeFileSync(join(repo, "pr-body.md"), "Rewords the intro.\n\nCloses #19\n");

      assertSilent(runHook(bashEvent('gh pr create --title "Tidy README" --body-file pr-body.md')));
    });
  });

  describe("is silent when the branch carries an issue number", () => {
    for (const branch of ["ticket-19", "spec-376-add-search", "spec/363-reader-zoom", "19-tidy-readme", "fix/issue_7"]) {
      it(`checked out: ${branch}`, () => {
        checkout(branch);

        assertSilent(runHook(bashEvent('gh pr create --title "Tidy README" --body "Rewords the intro."')));
      });
    }

    for (const head of ["--head ticket-19", "--head=ticket-19", "-H grimfeld:spec-376-add-search"]) {
      it(`given as ${head}`, () => {
        checkout("main");

        assertSilent(runHook(bashEvent(`gh pr create ${head} --title "Tidy README" --body "Rewords the intro."`)));
      });
    }
  });

  it("warns when the issue-like digits are only part of a word, as in a worktree branch", () => {
    checkout("worktree-agent-a97562946d8bc99f2");

    assertWarns(runHook(bashEvent('gh pr create --title "Tidy README" --body "Rewords the intro."')));
  });

  it("warns about the --head branch rather than the checked-out one", () => {
    checkout("ticket-19");

    assertWarns(runHook(bashEvent('gh pr create --head tidy-readme --title "Tidy README" --body "Rewords."')));
  });

  it("warns when gh pr create follows other commands in the same call", () => {
    checkout("tidy-readme");

    assertWarns(runHook(bashEvent('git push -u origin HEAD && gh pr create --title "Tidy README" --body "Rewords."')));
  });

  describe("is silent for commands that don't open a PR", () => {
    for (const command of ["gh pr view 19", "gh pr list", 'git commit -m "Document gh pr create"', "ls"]) {
      it(command, () => {
        checkout("tidy-readme");

        assertSilent(runHook(bashEvent(command)));
      });
    }
  });

  describe("is silent when it can't tell what the body will be", () => {
    for (const flags of ["--fill", "--fill-first", "--fill-verbose", "--body-file -", "--web"]) {
      it(flags, () => {
        checkout("tidy-readme");

        assertSilent(runHook(bashEvent(`gh pr create ${flags}`)));
      });
    }
  });

  describe("never blocks the command", () => {
    it("on input that isn't valid JSON", () => {
      assertSilent(runHook("not json"));
    });

    it("when the body file can't be read", () => {
      checkout("tidy-readme");

      assertSilent(runHook(bashEvent('gh pr create --title "Tidy README" --body-file missing.md')));
    });

    it("when the cwd isn't a git checkout and no --head is given", () => {
      assertSilent(runHook(bashEvent('gh pr create --title "Tidy README" --body "Rewords."')));
    });

    it("for another tool", () => {
      assertSilent(runHook(bashEvent("", { tool_name: "Write", tool_input: { file_path: "x", content: "" } })));
    });
  });

  it("still warns when the body only mentions an issue without closing it", () => {
    checkout("tidy-readme");

    assertWarns(runHook(bashEvent('gh pr create --title "Tidy README" --body "Follows up on #19."')));
  });

  it("still warns when a --body-file has no closing reference", () => {
    checkout("tidy-readme");
    writeFileSync(join(repo, "pr-body.md"), "Rewords the intro.\n");

    assertWarns(runHook(bashEvent('gh pr create --title "Tidy README" -F pr-body.md')));
  });
});
