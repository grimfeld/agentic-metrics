import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { readConfig } from "../../cli/config.ts";
import type { ActionsPolicy, RepoAdmin } from "../../cli/init.ts";

const WORKFLOW = ".github/workflows/agentic-metrics.yml";

let cwd: string;
let stdout: string;
let stderr: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-init-"));
  stdout = "";
  stderr = "";
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const MAIN_SHA = "1111111111111111111111111111111111111111";
const TAG_SHA = "2222222222222222222222222222222222222222";

/**
 * A fake of the repo's GitHub admin calls: the repo's visibility, its labels,
 * its Actions permissions, and the commits of the tool's own repo.
 */
function fakeGitHub(
  options: {
    private?: boolean;
    labels?: string[];
    actions?: ActionsPolicy | Error;
    /** The tool repo's refs and the commits they point at. */
    refs?: Record<string, string>;
  } = {},
) {
  const labels = [...(options.labels ?? ["bug", "ready-for-agent"])];
  const created: { name: string; color: string; description: string }[] = [];
  const refs = options.refs ?? { main: MAIN_SHA };
  const admin: RepoAdmin = {
    repo: () => Promise.resolve({ fullName: "acme/widgets", private: options.private ?? false }),
    actionsPolicy: () =>
      options.actions instanceof Error
        ? Promise.reject(options.actions)
        : Promise.resolve(options.actions ?? { allowedActions: "all", patternsAllowed: [], shaPinningRequired: false }),
    commitSha: (repo, ref) => Promise.resolve(repo === "grimfeld/agentic-metrics" ? refs[ref] : undefined),
    labels: () => Promise.resolve([...labels]),
    createLabel: (label) => {
      created.push(label);
      labels.push(label.name);
      return Promise.resolve();
    },
  };
  return { admin, created };
}

async function init(admin: RepoAdmin, args: string[] = [], version = "9.9.9"): Promise<number> {
  stdout = "";
  return main(["init", ...args], {
    cwd,
    admin,
    version,
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
}

function configFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(cwd, ".agentic-metrics.json"), "utf8")) as Record<string, unknown>;
}

describe("init", () => {
  it("writes a config holding every field, with defaults that exclude Dependabot", async () => {
    const { admin } = fakeGitHub();
    assert.equal(await init(admin), 0, stderr);

    const file = configFile();
    assert.equal(file["readyLabel"], "ready-for-agent");
    assert.equal(typeof file["branchRegex"], "string");
    assert.equal(file["integrationBranchPrefix"], "integration/");
    assert.deepEqual(file["exclude"], { authors: ["dependabot"], branches: ["dependabot/"] });
    assert.deepEqual(file["autonomy"], { fullMaxFollowUps: 1, fullMinClaudeCommitShare: 1 });
    assert.equal(file["publish"], "full");
    assert.equal("alias" in file, false);

    // The file reads back as a valid config, and its branch pattern links the usual branch names.
    const config = readConfig(cwd);
    assert.equal(config.branchRegex.exec("spec-376-title")?.[2], "376");
  });

  it("names the repo's own PR check workflow as ciWorkflow, so the installed workflow can't be taken for it", async () => {
    mkdirSync(join(cwd, ".github/workflows"), { recursive: true });
    writeFileSync(join(cwd, ".github/workflows/pages.yml"), "on:\n  push:\n    branches: [main]\n");
    writeFileSync(join(cwd, ".github/workflows/check.yml"), "on:\n  pull_request:\n  push:\n");
    const { admin } = fakeGitHub();
    assert.equal(await init(admin), 0, stderr);

    assert.equal(configFile()["ciWorkflow"], ".github/workflows/check.yml");
  });

  it("leaves ciWorkflow unset when no single PR check workflow stands out", async () => {
    mkdirSync(join(cwd, ".github/workflows"), { recursive: true });
    writeFileSync(join(cwd, ".github/workflows/a.yml"), "on: [pull_request]\n");
    writeFileSync(join(cwd, ".github/workflows/b.yaml"), "on: pull_request\n");
    const { admin } = fakeGitHub();
    assert.equal(await init(admin), 0, stderr);

    assert.equal("ciWorkflow" in configFile(), false);
    assert.match(stdout, /ciWorkflow/);
  });

  it("publishes a private repo anonymized, under the alias given", async () => {
    const { admin } = fakeGitHub({ private: true });
    assert.equal(await init(admin, ["--alias", "client-a"]), 0, stderr);

    assert.equal(configFile()["publish"], "anonymized");
    assert.equal(configFile()["alias"], "client-a");
  });

  it("derives an alias that doesn't name a private repo, and says so", async () => {
    const { admin } = fakeGitHub({ private: true });
    assert.equal(await init(admin), 0, stderr);

    const alias = configFile()["alias"];
    assert.equal(typeof alias, "string");
    assert.doesNotMatch(String(alias), /acme|widgets/i);
    assert.equal(readConfig(cwd).alias, alias);
    assert.match(stdout, new RegExp(`${String(alias)}.*random`));
  });

  it("picks a random alias, so the repo's name can't be recovered from it by hashing", async () => {
    const { admin } = fakeGitHub({ private: true });
    assert.equal(await init(admin), 0, stderr);
    const first = configFile()["alias"];
    rmSync(join(cwd, ".agentic-metrics.json"));
    assert.equal(await init(admin), 0, stderr);

    assert.notEqual(configFile()["alias"], first);
  });

  it("refuses an alias that isn't a plain name, writing nothing", async () => {
    const { admin, created } = fakeGitHub({ private: true });
    assert.equal(await init(admin, ["--alias", "../client a"]), 1);

    assert.match(stderr, /alias/);
    assert.equal(existsSync(join(cwd, ".agentic-metrics.json")), false);
    assert.equal(existsSync(join(cwd, WORKFLOW)), false);
    assert.deepEqual(created, []);
  });

  it("creates the regression and autonomy labels that are missing", async () => {
    const { admin, created } = fakeGitHub({ labels: ["bug", "Regression"] });
    assert.equal(await init(admin), 0, stderr);

    assert.deepEqual(
      created.map((label) => label.name),
      ["autonomy:full", "autonomy:assisted", "autonomy:manual"],
    );
    for (const label of created) assert.match(label.color, /^[0-9a-f]{6}$/);
  });

  it("installs the Action workflow with the config's ready label and branch pattern", async () => {
    writeFileSync(join(cwd, ".agentic-metrics.json"), JSON.stringify({ readyLabel: "ready", branchRegex: "^it's-(\\d+)" }));
    const { admin } = fakeGitHub();
    assert.equal(await init(admin), 0, stderr);

    const workflow = readFileSync(join(cwd, WORKFLOW), "utf8");
    assert.match(workflow, /pull_request:\n\s+types: \[opened, edited, reopened\]/);
    assert.match(workflow, /issues:\n\s+types: \[opened, edited, labeled\]/);
    assert.match(workflow, /issue_comment:\n\s+types: \[created\]/);
    assert.match(workflow, /pull-requests: write/);
    assert.match(workflow, /issues: write/);
    assert.ok(workflow.includes(`uses: grimfeld/agentic-metrics/action@${MAIN_SHA} # main\n`), workflow);
    assert.match(workflow, /ready-label: 'ready'/);
    assert.match(workflow, /bug-label: 'bug'/);
    assert.ok(workflow.includes("branch-regex: '^it''s-(\\d+)'"), workflow);
  });

  it("pins the Action to the commit of the release tag matching the CLI's version", async () => {
    const { admin } = fakeGitHub({ refs: { main: MAIN_SHA, "v1.2.0": TAG_SHA } });
    assert.equal(await init(admin, [], "1.2.0"), 0, stderr);

    const workflow = readFileSync(join(cwd, WORKFLOW), "utf8");
    assert.ok(workflow.includes(`uses: grimfeld/agentic-metrics/action@${TAG_SHA} # v1.2.0\n`), workflow);
  });

  it("refuses to install a workflow it can't pin, writing nothing", async () => {
    const { admin, created } = fakeGitHub({ refs: {} });
    assert.equal(await init(admin), 1);

    assert.match(stderr, /grimfeld\/agentic-metrics/);
    assert.equal(existsSync(join(cwd, WORKFLOW)), false);
    assert.equal(existsSync(join(cwd, ".agentic-metrics.json")), false);
    assert.deepEqual(created, []);
  });

  it("prints the pattern to allow when the repo allows only selected actions and none covers the Action", async () => {
    const { admin } = fakeGitHub({
      actions: { allowedActions: "selected", patternsAllowed: ["pnpm/action-setup@*", "grimfeld/other/*"], shaPinningRequired: true },
    });
    assert.equal(await init(admin), 0, stderr);

    assert.match(stdout, /grimfeld\/agentic-metrics\/action@\*/);
    assert.match(stdout, /Settings > Actions > General/);
  });

  it("asks for nothing when an allowed pattern already covers the Action", async () => {
    // grimfeld/lifeline's settings.
    const { admin } = fakeGitHub({
      actions: {
        allowedActions: "selected",
        patternsAllowed: ["superfly/flyctl-actions/*", "pnpm/action-setup@*", "grimfeld/agentic-metrics/action@*"],
        shaPinningRequired: true,
      },
    });
    assert.equal(await init(admin), 0, stderr);

    assert.match(stdout, /allowed \(by grimfeld\/agentic-metrics\/action@\*\)/);
    assert.doesNotMatch(stdout, /add grimfeld/);
  });

  it("counts an owner-wide pattern as covering the Action", async () => {
    const { admin } = fakeGitHub({ actions: { allowedActions: "selected", patternsAllowed: ["grimfeld/*"], shaPinningRequired: false } });
    assert.equal(await init(admin), 0, stderr);

    assert.match(stdout, /allowed \(by grimfeld\/\*\)/);
  });

  it("says nothing of permissions when the repo allows all actions", async () => {
    const { admin } = fakeGitHub({ actions: { allowedActions: "all", patternsAllowed: [], shaPinningRequired: false } });
    assert.equal(await init(admin), 0, stderr);

    assert.doesNotMatch(stdout, /actions permissions/);
  });

  it("still onboards when the Actions settings can't be read, naming the pattern to check", async () => {
    const { admin } = fakeGitHub({ actions: new Error("HTTP 403: Must have admin rights to Repository.") });
    assert.equal(await init(admin), 0, stderr);

    assert.ok(existsSync(join(cwd, WORKFLOW)));
    assert.match(stdout, /not read \(HTTP 403.*grimfeld\/agentic-metrics\/action@\*/);
  });

  it("warns about a kept workflow that isn't pinned when the repo requires SHA pinning", async () => {
    mkdirSync(join(cwd, ".github/workflows"), { recursive: true });
    writeFileSync(join(cwd, WORKFLOW), "    steps:\n      - uses: grimfeld/agentic-metrics/action@main\n");
    const { admin } = fakeGitHub({ actions: { allowedActions: "all", patternsAllowed: [], shaPinningRequired: true } });
    assert.equal(await init(admin), 0, stderr);

    assert.equal(readFileSync(join(cwd, WORKFLOW), "utf8"), "    steps:\n      - uses: grimfeld/agentic-metrics/action@main\n");
    assert.match(stdout, /requires actions pinned to a full commit SHA/);
  });

  it("is safe to run again: keeps the config and workflow, creates no label twice", async () => {
    const { admin, created } = fakeGitHub({ private: true });
    assert.equal(await init(admin, ["--alias", "client-a"]), 0, stderr);
    const config = readFileSync(join(cwd, ".agentic-metrics.json"), "utf8");
    writeFileSync(join(cwd, WORKFLOW), "# edited by hand\n");
    const labelsCreated = created.length;

    assert.equal(await init(admin, ["--alias", "other"]), 0, stderr);

    assert.equal(readFileSync(join(cwd, ".agentic-metrics.json"), "utf8"), config);
    assert.equal(readFileSync(join(cwd, WORKFLOW), "utf8"), "# edited by hand\n");
    assert.equal(created.length, labelsCreated);
    assert.match(stdout, /kept/);
  });
});
