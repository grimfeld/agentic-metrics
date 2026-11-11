// `agentic-metrics init`: onboards the repo at `cwd`. Writes its config with
// every field set, creates the labels the metrics read, and installs the
// GitHub Action workflow. Safe to run again: nothing that exists is replaced.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_BRANCH_REGEX } from "./branch.ts";
import { CONFIG_FILE, isAlias, readConfig, type PublishMode } from "./config.ts";
import { ACTION_WORKFLOW, REGRESSION_LABEL } from "./conventions.ts";
import type { Inferred } from "./infer.ts";
import { installRecorder } from "./recorder-install.ts";

/** The GitHub calls `init` makes: the CLI's boundary to the repo's settings. */
export interface RepoAdmin {
  repo(): Promise<{ fullName: string; private: boolean }>;
  /** The names of the repo's labels. */
  labels(): Promise<string[]>;
  createLabel(label: Label): Promise<void>;
  /** Which actions the repo's workflows may use (Settings > Actions > General). */
  actionsPolicy(): Promise<ActionsPolicy>;
  /** The full SHA of the commit `ref` (a branch or tag) names in `repo`; undefined when there is no such ref. */
  commitSha(repo: string, ref: string): Promise<string | undefined>;
}

export interface ActionsPolicy {
  allowedActions: "all" | "local_only" | "selected";
  /** The `owner/repo/path@ref` patterns allowed, when `allowedActions` is `selected`. */
  patternsAllowed: string[];
  shaPinningRequired: boolean;
}

export interface Label {
  name: string;
  /** Six hex digits, no `#`. */
  color: string;
  description: string;
}

export interface InitOptions {
  /** The name an anonymized repo is published under; a random one when unset. */
  alias?: string | undefined;
  /** Overrides the default publish mode (`anonymized` for a private repo, else `full`). */
  publish?: PublishMode | undefined;
  /** The CLI's version, whose release the Action is pinned to; package.json's when unset. */
  version?: string | undefined;
  /** Conventions inferred from the repo's history (`infer.ts`), written in place of the defaults. */
  inferred?: Omit<Inferred, "usesIssues"> | undefined;
}

export const WORKFLOW_FILE = ACTION_WORKFLOW;

/** The repo the Action lives in, and its path there. */
const TOOL_REPO = "grimfeld/agentic-metrics";
const ACTION = `${TOOL_REPO}/action`;
/** The allow-list pattern that admits every version of the Action. */
export const ACTION_PATTERN = `${ACTION}@*`;

function packageVersion(): string {
  // ../package.json from both cli/init.ts and dist/init.js.
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  return pkg.version;
}

/**
 * The ref the workflow pins the Action to, and its commit: the release tag of
 * this CLI's version (`v0.2.0`) when the tool repo has it, so the Action and
 * the CLI that installed it match; else `main`.
 */
async function actionPin(admin: RepoAdmin, version: string): Promise<{ ref: string; sha: string }> {
  for (const ref of [`v${version}`, "main"]) {
    const sha = await admin.commitSha(TOOL_REPO, ref);
    if (sha) return { ref, sha };
  }
  throw new Error(`can't pin the Action: neither v${version} nor main resolves to a commit in ${TOOL_REPO}`);
}

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
  const workflowPath = join(cwd, WORKFLOW_FILE);
  // Resolved before anything is written: a workflow that can't be pinned is no reason to half-onboard.
  const pin = existsSync(workflowPath) ? undefined : await actionPin(admin, options.version ?? packageVersion());

  const configPath = join(cwd, CONFIG_FILE);
  const inferred = options.inferred ?? {};
  // Written as they were inferred, else as the defaults: the conventions the Action and `collect` follow.
  const conventions = {
    readyLabel: inferred.readyLabel ?? "ready-for-agent",
    branchRegex: inferred.branchRegex ?? DEFAULT_BRANCH_REGEX.source,
    bugLabel: inferred.bugLabel ?? BUG_LABEL,
  };
  const inferredNote = (fields: string[]) => {
    const found = fields.filter((field) => inferred[field as keyof typeof inferred] !== undefined);
    return found.length ? `; inferred from history: ${found.map((field) => `${field} ${JSON.stringify(conventions[field as keyof typeof conventions])}`).join(", ")}` : "";
  };
  if (existsSync(configPath)) {
    // A config written before a convention field existed, or without it, gains that field's inferred value; a field set is never changed.
    const file = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    const missing = (["readyLabel", "branchRegex", "bugLabel"] as const).filter((field) => !(field in file) && inferred[field] !== undefined);
    if (missing.length === 0) {
      lines.push(`${CONFIG_FILE}: kept as it is`);
    } else {
      for (const field of missing) file[field] = conventions[field];
      await writeFile(configPath, `${JSON.stringify(file, null, 2)}\n`);
      lines.push(`${CONFIG_FILE}: kept, with ${missing.join(", ")} added${inferredNote(missing)}`);
    }
  } else {
    const publish = options.publish ?? (repo.private ? "anonymized" : "full");
    const file: Record<string, unknown> = {
      readyLabel: conventions.readyLabel,
      bugLabel: conventions.bugLabel,
      branchRegex: conventions.branchRegex,
      integrationBranchPrefix: "integration/",
      exclude: { authors: ["dependabot"], branches: ["dependabot/"] },
      autonomy: { fullMaxFollowUps: 1, fullMinClaudeCommitShare: 1 },
      publish,
    };
    let note = `publish: ${publish}${options.publish || !repo.private ? "" : " (the repo is private)"}`;
    if (publish === "anonymized") {
      file["alias"] = options.alias ?? randomAlias();
      note += options.alias ? `, alias ${options.alias}` : `, alias ${String(file["alias"])} (random; pass --alias or edit the file to choose one)`;
    } else if (options.alias) {
      file["alias"] = options.alias;
    }
    const check = prCheckWorkflow(cwd);
    if (check) file["ciWorkflow"] = check;
    note += check ? `, ciWorkflow ${check}` : ", ciWorkflow unset (no single PR check workflow found; set it to the main check workflow)";
    note += inferredNote(["readyLabel", "branchRegex", "bugLabel"]);
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

  if (!pin) {
    lines.push(`${WORKFLOW_FILE}: kept as it is`);
  } else {
    await mkdir(dirname(workflowPath), { recursive: true });
    await writeFile(workflowPath, workflow({ readyLabel: config.readyLabel, bugLabel: config.bugLabel, branchRegex: config.branchRegex.source, pin }));
    lines.push(`${WORKFLOW_FILE}: written (${ACTION} pinned to ${pin.sha}, ${pin.ref})`);
  }
  lines.push(...(await allowListing(admin, repo.fullName, pin ? undefined : readFileSync(workflowPath, "utf8"))));
  lines.push(...installRecorder(cwd));
  return lines;
}

const ALLOW_SETTING = "Settings > Actions > General > Actions permissions > Allow specified actions and reusable workflows";

/**
 * What the repo's Actions settings need for the Action to run, as lines to
 * print. `init` reads the settings and never changes them: allowing an action
 * is the repo admin's call. `keptWorkflow` is the workflow found in place, if any.
 */
async function allowListing(admin: RepoAdmin, repo: string, keptWorkflow: string | undefined): Promise<string[]> {
  let policy: ActionsPolicy;
  try {
    policy = await admin.actionsPolicy();
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n").find((line) => line.trim()) : String(error);
    return [`actions permissions: not read (${reason ?? "unknown error"}); if ${repo} allows only selected actions, add ${ACTION_PATTERN} under ${ALLOW_SETTING}`];
  }
  const lines: string[] = [];
  if (policy.allowedActions === "local_only") {
    lines.push(`actions permissions: ${repo} allows only its own actions, so the Action can't run; to run it, choose "Allow specified actions" and add ${ACTION_PATTERN} under ${ALLOW_SETTING} (init changes no settings)`);
  } else if (policy.allowedActions === "selected") {
    const covering = policy.patternsAllowed.find((pattern) => covers(pattern, `${ACTION}@${"0".repeat(40)}`));
    lines.push(
      covering
        ? `actions permissions: ${ACTION} is allowed (by ${covering})`
        : `actions permissions: ${repo} allows only selected actions; add ${ACTION_PATTERN} under ${ALLOW_SETTING} (init changes no settings)`,
    );
  }
  if (policy.shaPinningRequired && keptWorkflow !== undefined && !new RegExp(`${ACTION}@[0-9a-f]{40}\\b`).test(keptWorkflow)) {
    lines.push(`${WORKFLOW_FILE}: ${repo} requires actions pinned to a full commit SHA, and this workflow's ${ACTION} isn't; pin it (see the README's GitHub Action section)`);
  }
  return lines;
}

/** Whether an allow-list pattern (`*` matches anything) admits `action` (`owner/repo/path@ref`). */
function covers(pattern: string, action: string): boolean {
  const regex = pattern.trim().split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${regex}$`, "i").test(action);
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
 * An alias that names nothing. Random, not a hash of the repo's name: anyone
 * who guesses the name could hash it and confirm the guess. It is written once
 * to the config, so it stays stable.
 */
function randomAlias(): string {
  return `repo-${randomBytes(4).toString("hex")}`;
}

/** YAML single-quoted scalar. */
function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function workflow(settings: { readyLabel: string; bugLabel: string; branchRegex: string; pin: { ref: string; sha: string } }): string {
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
      - uses: ${ACTION}@${settings.pin.sha} # ${settings.pin.ref}
        with:
          branch-regex: ${quote(settings.branchRegex)}
          bug-label: ${quote(settings.bugLabel)}
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
    async actionsPolicy() {
      const name = await repoName();
      const permissions = JSON.parse(await gh(["api", `repos/${name}/actions/permissions`])) as {
        enabled: boolean;
        allowed_actions?: ActionsPolicy["allowedActions"];
        sha_pinning_required?: boolean;
      };
      const allowedActions = permissions.allowed_actions ?? "all";
      let patternsAllowed: string[] = [];
      if (allowedActions === "selected") {
        const selected = JSON.parse(await gh(["api", `repos/${name}/actions/permissions/selected-actions`])) as { patterns_allowed?: string[] };
        patternsAllowed = selected.patterns_allowed ?? [];
      }
      return { allowedActions, patternsAllowed, shaPinningRequired: permissions.sha_pinning_required ?? false };
    },
    async commitSha(repo, ref) {
      try {
        const sha = (await gh(["api", `repos/${repo}/commits/${encodeURIComponent(ref)}`, "--jq", ".sha"])).trim();
        return /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
      } catch (error) {
        // 404 / 422: no such ref. Anything else (no network, no login) is the caller's to see.
        if (/HTTP 4(04|22)/.test(error instanceof Error ? error.message : String(error))) return undefined;
        throw error;
      }
    },
  };
  async function repoName(): Promise<string> {
    return (await gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])).trim();
  }
}
