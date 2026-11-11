// `doctor`: what data is missing for a repo, and the one fix for each gap. It
// shows the gaps `collect` writes to the dataset (`gaps.ts`), plus what only
// the device it runs on can tell: whether the plugin caches this device's
// transcripts, and how long Claude Code keeps them otherwise.
//
// It changes nothing: every fix is printed, for the person to run.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Fix, Gap } from "./gaps.ts";

/** The plugin's key in Claude Code's `enabledPlugins`, under any marketplace. */
const PLUGIN = "agentic-metrics@";
/** How long Claude Code keeps transcripts when `cleanupPeriodDays` is unset. */
const DEFAULT_CLEANUP_DAYS = 30;

/** Claude Code's user folder: `$CLAUDE_CONFIG_DIR`, else `~/.claude`. */
export function defaultClaudeDir(): string {
  return process.env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude");
}

/** The gaps of the device whose Claude Code user folder is `claudeDir`. */
export function deviceGaps(claudeDir: string): Gap[] {
  const settings = readSettings(join(claudeDir, "settings.json"));
  const plugins = settings["enabledPlugins"];
  const installed =
    typeof plugins === "object" && plugins !== null && Object.entries(plugins).some(([key, enabled]) => key.startsWith(PLUGIN) && enabled === true);
  if (installed) return [];
  const gaps: Gap[] = [
    {
      id: "plugin-missing",
      cause: "The agentic-metrics plugin is not enabled on this device: its transcripts are not cached, so Claude Code's cleanup deletes them.",
      metrics: ["activeTime", "humanMessagesPerTicket", "subAgents", "apiEquivalentCost", "autonomy", "orchestrationTime"],
      fix: { kind: "command", command: "/plugin marketplace add grimfeld/agentic-metrics, then /plugin install agentic-metrics@agentic-metrics (in Claude Code)" },
    },
  ];
  const days = settings["cleanupPeriodDays"];
  if (typeof days !== "number" || days <= DEFAULT_CLEANUP_DAYS) {
    gaps.push({
      id: "transcripts-expire",
      cause: `Without the plugin, this device keeps transcripts for ${String(typeof days === "number" ? days : DEFAULT_CLEANUP_DAYS)} days (cleanupPeriodDays), then deletes them.`,
      metrics: ["activeTime", "humanMessagesPerTicket", "apiEquivalentCost"],
      fix: { kind: "settings", text: `Set "cleanupPeriodDays": 365 (or more) in ${join(claudeDir, "settings.json")}.` },
    });
  }
  return gaps;
}

function readSettings(path: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** What `doctor` prints: the repo's gaps, largest first, then this device's. */
export function formatDoctor(repo: string, tickets: number, gaps: Gap[], device: Gap[]): string {
  const lines = [`${repo}: ${String(tickets)} delivered tickets`];
  if (gaps.length === 0) lines.push("", "No gap: every metric has the data it needs.");
  for (const gap of gaps) lines.push("", ...formatGap(gap));
  lines.push("", "This device:");
  if (device.length === 0) lines.push("", "The plugin caches this device's transcripts.");
  for (const gap of device) lines.push("", ...formatGap(gap));
  return `${lines.join("\n")}\n`;
}

function formatGap(gap: Gap): string[] {
  const scope = gap.tickets === undefined ? "repo" : `${String(gap.tickets)} ticket${gap.tickets === 1 ? "" : "s"}`;
  const lines = [`[${scope}] ${gap.cause}`, `  affects: ${gap.metrics.join(", ")}`];
  if (gap.ticketIds) lines.push(`  tickets: ${abbreviate(gap.ticketIds)}`);
  lines.push(`  fix: ${fixText(gap.fix)}`);
  return lines;
}

function abbreviate(ids: string[]): string {
  const shown = 10;
  return ids.length <= shown ? ids.join(", ") : `${ids.slice(0, shown).join(", ")} and ${String(ids.length - shown)} more`;
}

export function fixText(fix: Fix): string {
  switch (fix.kind) {
    case "command":
      return `run ${fix.command}`;
    case "config":
    case "convention":
    case "settings":
      return fix.text;
    case "unfixable":
      return `none: ${fix.reason}`;
  }
}
