// PreToolUse hook on Bash: warn when `gh pr create` opens a PR that names no
// ticket, i.e. its body has no closing reference and its branch carries no
// issue number.
//
// It only ever warns. It never sets a permission decision and always exits 0,
// so ticketless PRs stay possible: the command runs (or is prompted for) as if
// the hook weren't there. Silent (no stdout) whenever a ticket is named or the
// hook can't tell.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// `gh pr create` as a command of its own: at the start, or after `;`, `&&`,
// `||`, `|`, `(` or a newline. Not when quoted inside another command.
const GH_PR_CREATE = /(?:^|[;&|(\n])\s*gh\s+pr\s+create\b/;

// Options that make gh write the body itself (from commits, stdin, or in the
// browser), so the hook can't see it.
const UNSEEN_BODY = /\s(?:--fill(?:-first|-verbose)?|--web|-w|--body-file[=\s]+-|-F\s+-)(?=\s|$)/;

// GitHub's closing keywords, then `#N` or `owner/repo#N`.
const CLOSING_REFERENCE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:[\w.-]+\/[\w.-]+)?#\d+/i;

// An issue number standing as its own segment of the branch name: `ticket-19`,
// `spec/363-zoom`, `19-tidy`, but not the digits inside `agent-a97562946d8`.
// Deliberately looser than the shared default branch regex (cli/branch.ts),
// which the plugin can't import: any number segment silences the warning. The
// hook doesn't read the config.
const BRANCH_ISSUE_NUMBER = /(?:^|[/_-])\d+(?=$|[/_-])/;

// The value of an option given as `--long value`, `--long=value` or `-s value`,
// unquoted or in single or double quotes.
function optionValue(command: string, long: string, short: string): string | undefined {
  const pattern = new RegExp(
    `(?:^|\\s)(?:--${long}(?:=|\\s+)|-${short}\\s+)(?:"([^"]*)"|'([^']*)'|([^\\s;&|)]+))`,
  );
  const match = pattern.exec(command);
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined;
}

// Whether the PR body closes a ticket. The body may be inline, in a heredoc or
// in a file, so the whole command text is searched, plus the body file if any.
function bodyClosesTicket(command: string, cwd: string): boolean {
  if (CLOSING_REFERENCE.test(command)) return true;
  const bodyFile = optionValue(command, "body-file", "F");
  return bodyFile !== undefined && CLOSING_REFERENCE.test(readFileSync(resolve(cwd, bodyFile), "utf8"));
}

function currentBranch(cwd: string): string | undefined {
  const result = spawnSync("git", ["-C", cwd, "branch", "--show-current"], { encoding: "utf8" });
  const branch = result.status === 0 ? result.stdout.trim() : "";
  return branch || undefined;
}

function warning(event: unknown): object | undefined {
  const { cwd, tool_name, tool_input } = (event ?? {}) as {
    cwd?: unknown;
    tool_name?: unknown;
    tool_input?: { command?: unknown };
  };
  const command = tool_input?.command;
  if (tool_name !== "Bash" || typeof command !== "string" || typeof cwd !== "string") return undefined;

  if (!GH_PR_CREATE.test(command) || UNSEEN_BODY.test(command)) return undefined;
  if (bodyClosesTicket(command, cwd)) return undefined;

  // `--head owner:branch` names a fork's branch; only the branch part matters.
  const head = optionValue(command, "head", "H")?.split(":").pop();
  const branch = head || currentBranch(cwd);
  if (branch === undefined || BRANCH_ISSUE_NUMBER.test(branch)) return undefined;

  return {
    systemMessage: `agentic-metrics: this PR has no \`Closes #N\` and branch ${branch} has no issue number.`,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext:
        `The PR body has no closing reference and branch ${branch} carries no issue number, ` +
        "so the PR won't be linked to a ticket. If a ticket exists, add `Closes #N` to the body.",
    },
  };
}

try {
  const output = warning(JSON.parse(readFileSync(0, "utf8")));
  if (output) process.stdout.write(JSON.stringify(output));
} catch (error) {
  process.stderr.write(`agentic-metrics: PR link not checked: ${String(error)}\n`);
}
