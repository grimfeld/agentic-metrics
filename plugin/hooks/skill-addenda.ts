// Skill addenda hook: when a skill loads, inject that skill's addendum as
// additional context, so third-party skills gain our conventions without
// being forked.
//
// Two events load a skill:
//   PostToolUse on the Skill tool    (Claude invoked it)  -> tool_input.skill
//   UserPromptExpansion              (the user typed /x)  -> command_name
// Both accept hookSpecificOutput.additionalContext.
//
// Addenda are looked up by skill name:
//   1. <repo>/.agentic-metrics/addenda/<name>.md  (per-repo override; an empty
//      file switches the addendum off for that repo)
//   2. <plugin>/addenda/<name>.md                 (shipped default)
// <repo> is the nearest folder at or above the event's cwd holding a .git
// entry. A namespaced skill ("plugin:name") is tried under its full name, then
// its short name.
//
// No addendum, or any error: exit 0 with nothing on stdout, so loading a skill
// is never disturbed.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SHIPPED = join(import.meta.dirname, "..", "addenda");
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._:-]*$/;

interface HookEvent {
  hook_event_name?: unknown;
  cwd?: unknown;
  tool_name?: unknown;
  tool_input?: { skill?: unknown } | null;
  command_name?: unknown;
}

function skillName(event: HookEvent): string | undefined {
  const name =
    event.hook_event_name === "PostToolUse" && event.tool_name === "Skill"
      ? event.tool_input?.skill
      : event.hook_event_name === "UserPromptExpansion"
        ? event.command_name
        : undefined;
  return typeof name === "string" ? name.replace(/^\//, "") : undefined;
}

function candidateNames(skill: string): string[] {
  const short = skill.slice(skill.lastIndexOf(":") + 1);
  return [...new Set([skill, short])].filter((name) => SAFE_NAME.test(name));
}

function repoRoot(cwd: string): string | undefined {
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

function findAddendum(skill: string, cwd: unknown): string | undefined {
  const repo = typeof cwd === "string" ? repoRoot(cwd) : undefined;
  const folders = repo ? [join(repo, ".agentic-metrics", "addenda"), SHIPPED] : [SHIPPED];
  for (const folder of folders) {
    for (const name of candidateNames(skill)) {
      const file = join(folder, `${name}.md`);
      if (existsSync(file)) return readFileSync(file, "utf8").trim();
    }
  }
  return undefined;
}

try {
  const event = JSON.parse(readFileSync(0, "utf8")) as HookEvent;
  const skill = skillName(event);
  const addendum = skill === undefined ? undefined : findAddendum(skill, event.cwd);
  if (addendum) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: event.hook_event_name, additionalContext: addendum },
      }),
    );
  }
} catch (error) {
  process.stderr.write(`agentic-metrics: no skill addendum: ${String(error)}\n`);
}
