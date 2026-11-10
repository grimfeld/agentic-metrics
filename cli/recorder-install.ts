// Installs the recorder (`recorder.mjs`) in a repo: the script itself, and its
// hook entries in the repo's `.claude/settings.json`. Both are committed, which
// is what makes the recorder run in Claude Code cloud sessions, where no plugin
// is loaded (docs/adr/0001). Whatever the settings file already holds is kept.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Where the script lives in a measured repo. */
export const RECORDER_FILE = ".agentic-metrics/recorder.mjs";
export const SETTINGS_FILE = ".claude/settings.json";

/**
 * The hook command. The project folder is the repo's root, whatever folder the
 * agent is in. It ends in `|| true` so that a missing script or a missing Node
 * is never an error to the session: a hook that fails can block a tool call.
 */
const COMMAND = `node "\${CLAUDE_PROJECT_DIR:-.}/${RECORDER_FILE}" 2>/dev/null || true`;

/** The events the recorder listens to, and the tools it matches where an event has any. */
const EVENTS: readonly { event: string; matcher?: string }[] = [
  { event: "UserPromptSubmit" },
  { event: "PreToolUse", matcher: "Bash" },
  { event: "PostToolUse" },
  { event: "Stop" },
  { event: "SubagentStop" },
];

/** The recorder's source, shipped beside this file (`cli/` from source, `dist/` once built). */
function recorderSource(): string {
  return readFileSync(new URL("./recorder.mjs", import.meta.url), "utf8");
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a hook group already runs the recorder. */
function runsRecorder(group: unknown): boolean {
  const hooks = isRecord(group) ? group["hooks"] : undefined;
  return Array.isArray(hooks) && hooks.some((hook) => isRecord(hook) && typeof hook["command"] === "string" && hook["command"].includes(RECORDER_FILE));
}

/** Installs or updates the recorder in the repo at `cwd`; returns the lines to report. */
export function installRecorder(cwd: string): string[] {
  const lines: string[] = [];

  const scriptPath = join(cwd, RECORDER_FILE);
  const source = recorderSource();
  const current = existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : undefined;
  if (current === source) {
    lines.push(`${RECORDER_FILE}: kept as it is`);
  } else {
    mkdirSync(dirname(scriptPath), { recursive: true });
    writeFileSync(scriptPath, source);
    lines.push(`${RECORDER_FILE}: ${current === undefined ? "written" : "updated to this version's recorder"}`);
  }

  const settingsPath = join(cwd, SETTINGS_FILE);
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      parsed = undefined;
    }
    if (!isRecord(parsed) || (parsed["hooks"] !== undefined && !isRecord(parsed["hooks"]))) {
      lines.push(`${SETTINGS_FILE}: not changed (it is not a JSON object with a "hooks" object); add the recorder's hooks by hand (see the README's Session records section)`);
      return lines;
    }
    settings = parsed;
  }

  const hooks: Record<string, unknown> = isRecord(settings["hooks"]) ? { ...settings["hooks"] } : {};
  const added: string[] = [];
  for (const { event, matcher } of EVENTS) {
    const existing = hooks[event];
    const groups: unknown[] = Array.isArray(existing) ? existing : [];
    if (groups.some(runsRecorder)) continue;
    hooks[event] = [...groups, { ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: "command", command: COMMAND }] }];
    added.push(event);
  }
  if (added.length === 0) {
    lines.push(`${SETTINGS_FILE}: kept as it is`);
  } else {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify({ ...settings, hooks }, null, 2)}\n`);
    lines.push(`${SETTINGS_FILE}: recorder hooks added (${added.join(", ")})`);
  }
  for (const file of [RECORDER_FILE, SETTINGS_FILE]) {
    if (gitIgnores(cwd, file)) lines.push(`${file}: ignored by git, so it won't be committed and the recorder won't run in cloud sessions or other clones; un-ignore it`);
  }
  return lines;
}

/** Whether the repo's ignore rules cover `file`; false when that can't be told (no git, not a repo). */
function gitIgnores(cwd: string, file: string): boolean {
  return spawnSync("git", ["check-ignore", "-q", file], { cwd, timeout: 5000 }).status === 0;
}
