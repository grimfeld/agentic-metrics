// Per-repo config, read from `.agentic-metrics.json` at the root of the
// consumer repo. Every field is optional; unknown fields are ignored so later
// versions can add their own.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILE = ".agentic-metrics.json";

export interface Config {
  /** The label that marks a ticket ready for work; lead time starts when it is added. */
  readyLabel: string;
  /** What `collect` may publish; unset means `full` for a public repo, `anonymized` for a private one. */
  publish?: PublishMode | undefined;
  /** The name an `anonymized` repo is published under, in place of `owner/name`. */
  alias?: string | undefined;
}

/**
 * `full`: titles and links. `anonymized`: aggregates only, under the alias.
 * `none`: a local report only; nothing in the datasets.
 */
export type PublishMode = "full" | "anonymized" | "none";

const PUBLISH_MODES: readonly string[] = ["full", "anonymized", "none"];

/** An alias is a plain name, safe as a file name and an HTML id: letters, digits, `-`, `_` and `.`, no path. */
const ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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
  if ("publish" in fields) {
    const publish = fields["publish"];
    if (typeof publish !== "string" || !PUBLISH_MODES.includes(publish)) {
      throw new Error(`${CONFIG_FILE}: publish must be one of ${PUBLISH_MODES.join(", ")}`);
    }
    config.publish = publish as PublishMode;
  }
  if ("alias" in fields) {
    const alias = fields["alias"];
    if (typeof alias !== "string" || !ALIAS.test(alias)) {
      throw new Error(`${CONFIG_FILE}: alias must be a plain name (letters, digits, "-", "_", ".")`);
    }
    config.alias = alias;
  }
  return config;
}
