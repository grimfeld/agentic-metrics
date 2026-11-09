// Per-repo config, read from `.agentic-metrics.json` at the root of the
// consumer repo. Every field is optional; unknown fields are ignored so later
// versions can add their own.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILE = ".agentic-metrics.json";

export interface Config {
  /** The label that marks a ticket ready for work; lead time starts when it is added. */
  readyLabel: string;
}

const DEFAULTS: Config = {
  readyLabel: "ready-for-agent",
};

export function readConfig(repoDir: string): Config {
  const path = join(repoDir, CONFIG_FILE);
  if (!existsSync(path)) return { ...DEFAULTS };

  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${CONFIG_FILE} must hold a JSON object`);
  }
  const fields = raw as Record<string, unknown>;
  const config = { ...DEFAULTS };
  if ("readyLabel" in fields) {
    if (typeof fields["readyLabel"] !== "string") throw new Error(`${CONFIG_FILE}: readyLabel must be a string`);
    config.readyLabel = fields["readyLabel"];
  }
  return config;
}
