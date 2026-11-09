// Per-repo config, read from `.agentic-metrics.json` at the root of the
// consumer repo. Every field is optional; unknown fields are ignored so later
// versions can add their own.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { branchRegex, DEFAULT_BRANCH_REGEX } from "./branch.ts";

export const CONFIG_FILE = ".agentic-metrics.json";

export interface Config {
  /** The label that marks a ticket ready for work; lead time starts when it is added. */
  readyLabel: string;
  /** What `collect` may publish; unset means `full` for a public repo, `anonymized` for a private one. */
  publish?: PublishMode | undefined;
  /** The name an `anonymized` repo is published under, in place of `owner/name`. */
  alias?: string | undefined;
  /**
   * Finds the issue number in a PR's branch name (case-insensitive): the first
   * capture group that matched, or the whole match. The file holds its source
   * as a string; the default is the one the GitHub Action uses.
   */
  branchRegex: RegExp;
  /** Branch-name prefixes of integration (batch) PRs. The file takes one string or a list. */
  integrationBranchPrefixes: string[];
  /** PRs by these authors (GitHub logins) or from branches starting with these prefixes count nowhere. */
  exclude: { authors: string[]; branches: string[] };
  /** When a ticket counts as `full` autonomy (see `autonomy.ts`). The file may set either field. */
  autonomy: AutonomyThresholds;
  /**
   * The repo's main check workflow, by file path (`.github/workflows/check.yml`),
   * file name (`check.yml`) or name (`Check`). Unset: the workflow that ran on
   * the most PRs.
   */
  ciWorkflow?: string | undefined;
}

export interface AutonomyThresholds {
  /** Human messages allowed beyond the opening request. */
  fullMaxFollowUps: number;
  /** The share of its commits Claude must have co-authored, from 0 to 1. */
  fullMinClaudeCommitShare: number;
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
  branchRegex: DEFAULT_BRANCH_REGEX,
  integrationBranchPrefixes: ["integration/"],
  exclude: { authors: [], branches: [] },
  autonomy: { fullMaxFollowUps: 1, fullMinClaudeCommitShare: 1 },
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
  if ("ciWorkflow" in fields) {
    const workflow = fields["ciWorkflow"];
    if (typeof workflow !== "string" || workflow === "") throw new Error(`${CONFIG_FILE}: ciWorkflow must be a non-empty string`);
    config.ciWorkflow = workflow;
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
  if ("branchRegex" in fields) {
    const pattern = fields["branchRegex"];
    if (typeof pattern !== "string") throw new Error(`${CONFIG_FILE}: branchRegex must be a string`);
    try {
      config.branchRegex = branchRegex(pattern);
    } catch (error) {
      throw new Error(`${CONFIG_FILE}: branchRegex is not a valid pattern: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
  }
  if ("integrationBranchPrefix" in fields) {
    const prefix = fields["integrationBranchPrefix"];
    config.integrationBranchPrefixes = typeof prefix === "string" ? [prefix] : stringList(prefix, "integrationBranchPrefix");
  }
  if ("exclude" in fields) {
    const exclude = fields["exclude"];
    if (typeof exclude !== "object" || exclude === null || Array.isArray(exclude)) {
      throw new Error(`${CONFIG_FILE}: exclude must be an object with "authors" and/or "branches"`);
    }
    const lists = exclude as Record<string, unknown>;
    config.exclude = {
      authors: "authors" in lists ? stringList(lists["authors"], "exclude.authors") : [],
      branches: "branches" in lists ? stringList(lists["branches"], "exclude.branches") : [],
    };
  }
  if ("autonomy" in fields) config.autonomy = autonomyThresholds(fields["autonomy"]);
  return config;
}

function autonomyThresholds(value: unknown): AutonomyThresholds {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${CONFIG_FILE}: autonomy must be an object with "fullMaxFollowUps" and/or "fullMinClaudeCommitShare"`);
  }
  const fields = value as Record<string, unknown>;
  const thresholds = { ...DEFAULTS.autonomy };
  if ("fullMaxFollowUps" in fields) {
    const followUps = fields["fullMaxFollowUps"];
    if (typeof followUps !== "number" || !Number.isInteger(followUps) || followUps < 0) {
      throw new Error(`${CONFIG_FILE}: autonomy.fullMaxFollowUps must be a whole number, 0 or more`);
    }
    thresholds.fullMaxFollowUps = followUps;
  }
  if ("fullMinClaudeCommitShare" in fields) {
    const share = fields["fullMinClaudeCommitShare"];
    if (typeof share !== "number" || !(share >= 0 && share <= 1)) {
      throw new Error(`${CONFIG_FILE}: autonomy.fullMinClaudeCommitShare must be a number from 0 to 1`);
    }
    thresholds.fullMinClaudeCommitShare = share;
  }
  return thresholds;
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${CONFIG_FILE}: ${field} must be a list of strings`);
  }
  return value;
}
