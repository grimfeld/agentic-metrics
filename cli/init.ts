// `agentic-metrics init`: onboards the repo at `cwd`. Writes its config with
// every field set, creates the labels the metrics read, and installs the
// GitHub Action workflow. Safe to run again: nothing that exists is replaced.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_BRANCH_REGEX } from "./branch.ts";
import { CONFIG_FILE, isAlias, readConfig, type PublishMode } from "./config.ts";
import { REGRESSION_LABEL } from "./conventions.ts";

/** The GitHub calls `init` makes: the CLI's boundary to the repo's settings. */
export interface RepoAdmin {
  repo(): Promise<{ fullName: string; private: boolean }>;
  /** The names of the repo's labels. */
  labels(): Promise<string[]>;
  createLabel(label: Label): Promise<void>;
}

export interface Label {
  name: string;
  /** Six hex digits, no `#`. */
  color: string;
  description: string;
}

export interface InitOptions {
  /** The name an anonymized repo is published under; derived from the repo when unset. */
  alias?: string | undefined;
  /** Overrides the default publish mode (`anonymized` for a private repo, else `full`). */
  publish?: PublishMode | undefined;
}

export const WORKFLOW_FILE = ".github/workflows/agentic-metrics.yml";

/** The bug label the Action watches; the config has no field for it. */
const BUG_LABEL = "bug";

export const LABELS: readonly Label[] = [
  { name: REGRESSION_LABEL, color: "b60205", description: "A bug caused by earlier work; reply caused-by: #N" },
  { name: "autonomy:full", color: "0e8a16", description: "agentic-metrics: override the computed autonomy level" },
  { name: "autonomy:assisted", color: "fbca04", description: "agentic-metrics: override the computed autonomy level" },
  { name: "autonomy:manual", color: "d93f0b", description: "agentic-metrics: override the computed autonomy level" },
];

/** Onboards the repo at `cwd`; returns the lines to report, one per step. */
export async function init(cwd: string, admin: RepoAdmin, options: InitOptions): Promise<string[]> {
  if (options.alias !== undefined && !isAlias(options.alias)) {
    throw new Error(`--alias must be a plain name (letters, digits, "-", "_", ".")`);
  }
  const lines: string[] = [];
  const repo = await admin.repo();

  const configPath = join(cwd, CONFIG_FILE);
  if (existsSync(configPath)) {
    lines.push(`${CONFIG_FILE}: kept as it is`);
  } else {
    const publish = options.publish ?? (repo.private ? "anonymized" : "full");
    const file: Record<string, unknown> = {
      readyLabel: "ready-for-agent",
      branchRegex: DEFAULT_BRANCH_REGEX.source,
      integrationBranchPrefix: "integration/",
      exclude: { authors: ["dependabot"], branches: ["dependabot/"] },
      autonomy: { fullMaxFollowUps: 1, fullMinClaudeCommitShare: 1 },
      publish,
    };
    let note = `publish: ${publish}${options.publish || !repo.private ? "" : " (the repo is private)"}`;
    if (publish === "anonymized") {
      file["alias"] = options.alias ?? derivedAlias(repo.fullName);
      note += options.alias ? `, alias ${options.alias}` : `, alias ${String(file["alias"])} (derived; pass --alias or edit the file to choose one)`;
    } else if (options.alias) {
      file["alias"] = options.alias;
    }
    const check = prCheckWorkflow(cwd);
    if (check) file["ciWorkflow"] = check;
    note += check ? `, ciWorkflow ${check}` : ", ciWorkflow unset (no single PR check workflow found; set it to the main check workflow)";
    await writeFile(configPath, `${JSON.stringify(file, null, 2)}\n`);
    lines.push(`${CONFIG_FILE}: written (${note})`);
  }
  // Reading it back validates a kept config, and the workflow takes its settings from it.
  const config = readConfig(cwd);

  const existing = new Set((await admin.labels()).map((name) => name.toLowerCase()));
  for (const label of LABELS) {
    if (existing.has(label.name.toLowerCase())) continue;
    await admin.createLabel(label);
    lines.push(`label ${label.name}: created`);
  }

  const workflowPath = join(cwd, WORKFLOW_FILE);
  if (existsSync(workflowPath)) {
    lines.push(`${WORKFLOW_FILE}: kept as it is`);
  } else {
    await mkdir(dirname(workflowPath), { recursive: true });
    await writeFile(workflowPath, workflow({ readyLabel: config.readyLabel, branchRegex: config.branchRegex.source }));
    lines.push(`${WORKFLOW_FILE}: written`);
  }
  return lines;
}

/**
 * The repo's main check workflow, when exactly one workflow besides ours runs
 * on pull requests. Unset, `collect` takes the workflow that ran on the most
 * PRs, which the installed workflow (it runs on every PR) could tie and win.
 */
function prCheckWorkflow(cwd: string): string | undefined {
  const dir = join(cwd, ".github", "workflows");
  if (!existsSync(dir)) return undefined;
  const candidates = readdirSync(dir)
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => `.github/workflows/${file}`)
    .filter((path) => path !== WORKFLOW_FILE && /\bpull_request\b(?!_)/.test(readFileSync(join(cwd, path), "utf8")));
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * A stable alias that names nothing: the repo's name would defeat anonymizing,
 * so it is a short hash of it.
 */
function derivedAlias(fullName: string): string {
  return `repo-${createHash("sha256").update(fullName.toLowerCase()).digest("hex").slice(0, 8)}`;
}

/** YAML single-quoted scalar. */
function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function workflow(settings: { readyLabel: string; branchRegex: string }): string {
  return `# Installed by \`agentic-metrics init\`. The inputs mirror ${CONFIG_FILE};
# change both together.
name: agentic-metrics
on:
  pull_request:
    types: [opened, edited, reopened]
  issues:
    types: [opened, edited, labeled]
  issue_comment:
    types: [created]
permissions:
  contents: read
  pull-requests: write
  issues: write
jobs:
  conventions:
    runs-on: ubuntu-latest
    steps:
      - uses: grimfeld/agentic-metrics/action@main
        with:
          branch-regex: ${quote(settings.branchRegex)}
          bug-label: ${quote(BUG_LABEL)}
          ready-label: ${quote(settings.readyLabel)}
`;
}

const run = promisify(execFile);

/** `RepoAdmin` through the `gh` CLI, for the repo `gh` resolves from `cwd`. */
export function ghAdmin(cwd: string): RepoAdmin {
  const gh = async (args: string[]): Promise<string> => (await run("gh", args, { cwd, maxBuffer: 16 * 1024 * 1024 })).stdout;
  return {
    async repo() {
      const view = JSON.parse(await gh(["repo", "view", "--json", "nameWithOwner,isPrivate"])) as { nameWithOwner: string; isPrivate: boolean };
      return { fullName: view.nameWithOwner, private: view.isPrivate };
    },
    async labels() {
      const list = JSON.parse(await gh(["label", "list", "--json", "name", "--limit", "1000"])) as { name: string }[];
      return list.map((label) => label.name);
    },
    async createLabel(label) {
      await gh(["label", "create", label.name, "--color", label.color, "--description", label.description]);
    },
  };
}
