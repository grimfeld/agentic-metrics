import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = join(import.meta.dirname, "../../plugin/hooks/skill-addenda.ts");
const EVENTS = join(import.meta.dirname, "../fixtures/hook-events");

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "am-addenda-"));
  mkdirSync(join(repo, ".git"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function fixtureEvent(name: string, overrides: Record<string, unknown> = {}): string {
  const event = JSON.parse(readFileSync(join(EVENTS, name), "utf8")) as Record<string, unknown>;
  return JSON.stringify({ ...event, cwd: repo, ...overrides });
}

function runHook(stdin: string) {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd: repo,
    input: stdin,
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "" },
  });
  return { status: result.status, stdout: result.stdout };
}

function injected(stdout: string): { hookEventName: string; additionalContext: string } {
  const output = JSON.parse(stdout) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
  return output.hookSpecificOutput;
}

describe("skill addenda hook", () => {
  it("injects the PR-writing addendum when Claude loads the pr skill", () => {
    const { status, stdout } = runHook(fixtureEvent("post-tool-use-skill.json"));

    assert.equal(status, 0);
    const output = injected(stdout);
    assert.equal(output.hookEventName, "PostToolUse");
    assert.match(output.additionalContext, /Notable intervention/);
  });

  it("injects the addendum when the user types the skill's slash command", () => {
    const { status, stdout } = runHook(fixtureEvent("user-prompt-expansion.json"));

    assert.equal(status, 0);
    const output = injected(stdout);
    assert.equal(output.hookEventName, "UserPromptExpansion");
    assert.match(output.additionalContext, /Notable intervention/);
  });

  it("ships an addendum for the bug-diagnosis and spec-implementation skills", () => {
    const diagnosis = runHook(fixtureEvent("post-tool-use-skill.json", { tool_input: { skill: "diagnosing-bugs" } }));
    const implementation = runHook(fixtureEvent("user-prompt-expansion.json", { command_name: "implement-spec" }));

    assert.match(injected(diagnosis.stdout).additionalContext, /caused-by: #N/);
    assert.match(injected(implementation.stdout).additionalContext, /estimate/);
  });

  it("finds the addendum of a namespaced skill by its short name", () => {
    const { stdout } = runHook(fixtureEvent("post-tool-use-skill.json", { tool_input: { skill: "workflow:pr" } }));

    assert.match(injected(stdout).additionalContext, /Notable intervention/);
  });

  describe("per-repo override", () => {
    function writeOverride(name: string, text: string): void {
      mkdirSync(join(repo, ".agentic-metrics", "addenda"), { recursive: true });
      writeFileSync(join(repo, ".agentic-metrics", "addenda", `${name}.md`), text);
    }

    it("replaces the shipped addendum of the same name", () => {
      writeOverride("pr", "This repo records interventions in the PR's last comment instead.\n");

      const { status, stdout } = runHook(fixtureEvent("post-tool-use-skill.json"));

      assert.equal(status, 0);
      assert.equal(
        injected(stdout).additionalContext,
        "This repo records interventions in the PR's last comment instead.",
      );
    });

    it("is found from a subfolder of the repo", () => {
      writeOverride("pr", "Repo-specific PR convention.");
      const subfolder = join(repo, "packages", "web");
      mkdirSync(subfolder, { recursive: true });

      const { stdout } = runHook(fixtureEvent("post-tool-use-skill.json", { cwd: subfolder }));

      assert.equal(injected(stdout).additionalContext, "Repo-specific PR convention.");
    });

    it("adds an addendum to a skill the plugin has none for", () => {
      writeOverride("grilling", "Record each settled decision as a ticket comment.");

      const { stdout } = runHook(fixtureEvent("post-tool-use-skill.json", { tool_input: { skill: "grilling" } }));

      assert.equal(injected(stdout).additionalContext, "Record each settled decision as a ticket comment.");
    });

    it("switches the addendum off when the override file is empty", () => {
      writeOverride("pr", "");

      const { status, stdout } = runHook(fixtureEvent("post-tool-use-skill.json"));

      assert.equal(status, 0);
      assert.equal(stdout, "");
    });
  });

  describe("stays silent", () => {
    it("when the skill has no addendum", () => {
      const { status, stdout } = runHook(fixtureEvent("post-tool-use-skill.json", { tool_input: { skill: "tdd" } }));

      assert.equal(status, 0);
      assert.equal(stdout, "");
    });

    it("when a tool other than Skill ran", () => {
      const { stdout } = runHook(
        fixtureEvent("post-tool-use-skill.json", { tool_name: "Bash", tool_input: { command: "ls", skill: "pr" } }),
      );

      assert.equal(stdout, "");
    });

    it("when the skill name would reach outside the addenda folder", () => {
      writeFileSync(join(repo, "secret.md"), "not an addendum");

      const { status, stdout } = runHook(
        fixtureEvent("post-tool-use-skill.json", { tool_input: { skill: "../../secret" } }),
      );

      assert.equal(status, 0);
      assert.equal(stdout, "");
    });

    it("when the event isn't valid JSON", () => {
      const { status, stdout } = runHook("not json");

      assert.equal(status, 0);
      assert.equal(stdout, "");
    });
  });
});
