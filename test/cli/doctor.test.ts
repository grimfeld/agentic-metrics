import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../cli/main.ts";
import { fixtureSource } from "../../cli/github/source.ts";

const FIXTURES = join(import.meta.dirname, "../fixtures/github");

let cwd: string;
let claudeDir: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "am-doctor-"));
  claudeDir = mkdtempSync(join(tmpdir(), "am-doctor-claude-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  rmSync(claudeDir, { recursive: true, force: true });
});

async function doctor(fixture = "lifeline"): Promise<string> {
  let out = "";
  const status = await main(["doctor"], {
    cwd,
    claudeDir,
    github: fixtureSource(join(FIXTURES, fixture)),
    now: () => new Date("2026-11-09T12:00:00Z"),
    stdout: (text) => (out += text),
  });
  assert.equal(status, 0);
  return out;
}

function settings(value: unknown) {
  writeFileSync(join(claudeDir, "settings.json"), JSON.stringify(value));
}

describe("doctor", () => {
  it("prints a repo missing the recorder with that gap and the init command", async () => {
    execFileSync("git", ["init", "-q"], { cwd });
    const out = await doctor();

    assert.match(out, /^grimfeld\/lifeline: 5 delivered tickets/);
    assert.match(out, /The recorder is not installed/);
    assert.match(out, /fix: run npx agentic-metrics init/);
  });

  it("prints repo-level gaps first, then the others by tickets affected", async () => {
    const out = await doctor();
    const order = ["[repo]", "[5 tickets]", "[1 ticket]"].map((marker) => out.indexOf(marker));

    assert.ok(order.every((at) => at >= 0), out);
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  it("suggests raising cleanupPeriodDays, as text, on a device with neither the plugin nor a longer period", async () => {
    const out = await doctor();

    assert.match(out, /This device:/);
    assert.match(out, /plugin is not enabled/);
    assert.match(out, /Set "cleanupPeriodDays": 365/);
  });

  it("finds nothing to say about a device whose plugin is enabled", async () => {
    settings({ enabledPlugins: { "agentic-metrics@agentic-metrics": true } });
    const out = await doctor();

    assert.match(out, /The plugin caches this device's transcripts/);
    assert.doesNotMatch(out, /cleanupPeriodDays/);
  });

  it("keeps quiet about the cleanup period once it is raised", async () => {
    settings({ cleanupPeriodDays: 400 });
    const out = await doctor();

    assert.match(out, /plugin is not enabled/);
    assert.doesNotMatch(out, /cleanupPeriodDays/);
  });

  it("writes nothing: no dataset, no file in the repo, nothing in ~/.claude", async () => {
    settings({});
    const before = { repo: readdirSync(cwd), claude: readFileSync(join(claudeDir, "settings.json"), "utf8") };
    await doctor();

    assert.deepEqual(readdirSync(cwd), before.repo);
    assert.equal(readFileSync(join(claudeDir, "settings.json"), "utf8"), before.claude);
    assert.equal(existsSync(join(cwd, "datasets")), false);
  });

  it("says when a repo has no gap", async () => {
    // A repo with nothing delivered has no ticket-level gap; set the recorder, Action and CI aside to leave none.
    execFileSync("git", ["init", "-q"], { cwd });
    for (const [file, text] of [
      [".agentic-metrics/recorder.mjs", ""],
      [".claude/settings.json", JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: ".agentic-metrics/recorder.mjs" }] }] } })],
      [".github/workflows/agentic-metrics.yml", ""],
    ] as const) {
      mkdirSync(join(cwd, file, ".."), { recursive: true });
      writeFileSync(join(cwd, file), text);
    }
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "."], { cwd });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x"], { cwd });
    const out = await doctor("empty");

    assert.match(out, /No gap: every metric has the data it needs/);
  });
});

describe("doctor: this device", () => {
  it("prints this device's id, read from the recorder's config file, and creates none", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "am-doctor-config-"));
    try {
      const run = async () => {
        let out = "";
        await main(["doctor"], { cwd, claudeDir, configDir, github: fixtureSource(join(FIXTURES, "lifeline")), stdout: (text) => (out += text) });
        return out;
      };
      assert.match(await run(), /This device: no id yet/);
      assert.equal(existsSync(join(configDir, "agentic-metrics")), false);
      mkdirSync(join(configDir, "agentic-metrics"));
      writeFileSync(join(configDir, "agentic-metrics", "device"), "0a1b2c3d\n");
      assert.match(await run(), /This device: 0a1b2c3d/);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
