// Gaps: data a metric needs that is missing, with the reason it is missing
// (GLOSSARY.md). `collect` works them out from the same inputs the metrics
// read, and writes them to the dataset beside the metrics; `doctor` and the
// report's coverage page show them with their fixes.
//
// A gap names no person and no text from the repo. In an anonymized dataset it
// keeps counts only (`anonymizeGaps`). A fix never names the repo, so the same
// gap reads the same under an alias.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE, type Config } from "./config.ts";
import { ACTION_WORKFLOW, REGRESSION_LABEL } from "./conventions.ts";
import type { GitHubData } from "./github/load.ts";
import { ACTION_PATTERN } from "./init.ts";
import { ownCommits, type LinkedWork } from "./linker.ts";
import { RECORDER_FILE, SETTINGS_FILE } from "./recorder-install.ts";

/** How to fill a gap. */
export type Fix =
  /** A command to run. */
  | { kind: "command"; command: string }
  /** A change to `.agentic-metrics.json`. */
  | { kind: "config"; text: string }
  /** A convention to follow from now on: it fills the gap for later tickets only. */
  | { kind: "convention"; text: string }
  /** A GitHub setting to change. */
  | { kind: "settings"; text: string }
  | { kind: "unfixable"; reason: string };

export interface Gap {
  id: string;
  /** What is missing and why, in words. */
  cause: string;
  /** The ids of the metrics it leaves unknown or partial. */
  metrics: string[];
  /** How many delivered tickets it affects; absent for a repo-level gap. */
  tickets?: number;
  /** Those tickets (`#104`, `PR #136`), in delivery order. Absent from an anonymized dataset. */
  ticketIds?: string[];
  /** For a gap of one device's sessions: that device's random id, or `unknown` for records that don't name one. */
  device?: string;
  /** For the cloud sessions gap: the sessions to teleport. Absent from an anonymized dataset. */
  teleport?: string[];
  fix: Fix;
}

/**
 * Whether a file `init` installs is in the measured repo's clone: missing,
 * present but not in its last commit, or committed. `unknown` when present in a
 * folder that is not a git work tree, so whether it is committed can't be told.
 */
export type Installed = "missing" | "not-committed" | "committed" | "unknown";

export interface CheckoutState {
  recorder: Installed;
  action: Installed;
}

/** The metrics a session (a transcript or a session record) feeds. */
const SESSION_METRICS = ["activeTime", "humanMessagesPerTicket", "subAgents", "apiEquivalentCost", "autonomy", "orchestrationTime"];
/** The metrics that read the main CI workflow's first result. */
const MAIN_CI_METRICS = ["firstRunCiRate", "batchHealth"];
/** The metrics the Action's conventions feed: issue links, the regression label, estimates. */
const ACTION_METRICS = ["throughput", "leadTime", "regressionRate", "estimateVsActual"];

const INIT = "npx agentic-metrics init";
const COMMIT_RECORDER = `git add ${RECORDER_FILE} ${SETTINGS_FILE} && git commit -m "Install the agentic-metrics recorder"`;
const COMMIT_ACTION = `git add ${ACTION_WORKFLOW} && git commit -m "Install the agentic-metrics workflow"`;
const IMPORT = "npx agentic-metrics import-transcripts <the other device's ~/.cache/agentic-metrics>";
const WITH_CHECKOUT = "npx agentic-metrics collect --repo <owner/name> --checkout <its clone>";

/** What `init` installed in the clone at `dir`. */
export function inspectCheckout(dir: string): CheckoutState {
  const tracked = gitTracked(dir);
  const state = (files: string[], installed: boolean): Installed => {
    if (!installed) return "missing";
    if (tracked === undefined) return "unknown";
    return files.every((file) => tracked(file)) ? "committed" : "not-committed";
  };
  return {
    recorder: state([RECORDER_FILE, SETTINGS_FILE], existsSync(join(dir, RECORDER_FILE)) && settingsRunRecorder(dir)),
    action: state([ACTION_WORKFLOW], existsSync(join(dir, ACTION_WORKFLOW))),
  };
}

function settingsRunRecorder(dir: string): boolean {
  try {
    return readFileSync(join(dir, SETTINGS_FILE), "utf8").includes(RECORDER_FILE);
  } catch {
    return false;
  }
}

/** Whether a file is in the last commit of the work tree at `dir`; undefined when `dir` is no git work tree. */
function gitTracked(dir: string): ((file: string) => boolean) | undefined {
  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, encoding: "utf8", timeout: 5000 });
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return undefined;
  return (file) => spawnSync("git", ["cat-file", "-e", `HEAD:${file}`], { cwd: dir, timeout: 5000 }).status === 0;
}

export interface GapInputs {
  work: LinkedWork;
  data: GitHubData;
  config: Config;
  /** The measured repo's clone; undefined when `collect` ran with `--repo` and no `--checkout`. */
  checkout: CheckoutState | undefined;
}

/** The repo's gaps: repo-level ones first, then by the number of tickets affected. */
export function findGaps({ work, data, config, checkout }: GapInputs): Gap[] {
  const gaps: Gap[] = [];
  const perTicket = (gap: Omit<Gap, "tickets" | "ticketIds">, ids: string[]) => {
    if (ids.length > 0) gaps.push({ ...gap, tickets: ids.length, ticketIds: ids });
  };
  const recorderCommitted = checkout?.recorder === "committed" || checkout?.recorder === "unknown";

  // Where sessions come from.
  if (checkout === undefined) {
    gaps.push({
      id: "no-checkout",
      cause: "Collected without the repo's clone: its transcripts were not read, and whether it has the recorder or the Action installed is not known.",
      metrics: SESSION_METRICS,
      fix: { kind: "command", command: WITH_CHECKOUT },
    });
  } else if (checkout.recorder === "missing") {
    gaps.push({
      id: "recorder-missing",
      cause: "The recorder is not installed: sessions on other devices and in cloud sessions leave no session record.",
      metrics: SESSION_METRICS,
      fix: { kind: "command", command: INIT },
    });
  } else if (checkout.recorder === "not-committed") {
    gaps.push({
      id: "recorder-not-committed",
      cause: "The recorder is installed but not committed: it runs only in this clone, not in cloud sessions or other clones.",
      metrics: SESSION_METRICS,
      fix: { kind: "command", command: COMMIT_RECORDER },
    });
  }
  perTicket(
    {
      id: "no-session-data",
      cause: "Tickets with neither a cached transcript nor a session record: their human messages, autonomy, sub-agents, cost and measured active time are unknown.",
      metrics: SESSION_METRICS,
      fix:
        checkout === undefined
          ? { kind: "command", command: WITH_CHECKOUT }
          : recorderCommitted
            ? { kind: "command", command: IMPORT }
            : { kind: "command", command: INIT },
    },
    work.tickets.filter((ticket) => ticket.sessions.length === 0).map((ticket) => ticket.id),
  );
  // Sessions known only through their records, by the device holding their transcripts. A cloud session's transcript is on no device.
  const byDevice = new Map<string, { sessions: Set<string>; tickets: Set<string> }>();
  const note = (session: (typeof work.tickets)[number]["sessions"][number], ticket: string | undefined) => {
    if (!session.recorded || session.recorded.cloud) return;
    const device = session.recorded.device ?? "unknown";
    const entry = byDevice.get(device) ?? { sessions: new Set<string>(), tickets: new Set<string>() };
    entry.sessions.add(session.agentId ?? session.sessionId);
    if (ticket !== undefined) entry.tickets.add(ticket);
    byDevice.set(device, entry);
  };
  for (const ticket of work.tickets) for (const session of ticket.sessions) note(session, ticket.id);
  for (const session of work.transcripts.orchestration) note(session, undefined);
  for (const [device, { sessions, tickets }] of [...byDevice].sort(([a], [b]) => (a === "unknown" ? 1 : b === "unknown" ? -1 : a.localeCompare(b)))) {
    const ids = work.tickets.filter((ticket) => tickets.has(ticket.id)).map((ticket) => ticket.id);
    const count = `${String(sessions.size)} session${sessions.size === 1 ? "" : "s"}`;
    gaps.push({
      id: "device-transcripts",
      device,
      cause:
        device === "unknown"
          ? `${count} known only through session records that name no device (written before records did) have no transcript here.`
          : `${count} from device ${device} have no transcript here: only their session records were read, which hold no token counts.`,
      metrics: ["apiEquivalentCost", "subAgents"],
      fix: {
        kind: "command",
        command:
          device === "unknown"
            ? IMPORT
            : `npx agentic-metrics import-transcripts <device ${device}'s ~/.cache/agentic-metrics>, or share one synced AGENTIC_METRICS_CACHE_DIR between devices`,
      },
      ...(ids.length > 0 ? { tickets: ids.length, ticketIds: ids } : {}),
    });
  }

  // Cloud sessions that left neither a record nor a transcript: their commits are all that is left, until teleported here.
  const teleport = new Map<string, Set<string>>();
  for (const ticket of work.tickets) {
    if (ticket.sessions.length > 0) continue;
    for (const commit of ownCommits(ticket)) {
      if (!commit.cloudSessionId || commit.records.length > 0) continue;
      teleport.set(commit.cloudSessionId, (teleport.get(commit.cloudSessionId) ?? new Set<string>()).add(ticket.id));
    }
  }
  if (teleport.size > 0) {
    const tickets = new Set([...teleport.values()].flatMap((ids) => [...ids]));
    const ids = work.tickets.filter((ticket) => tickets.has(ticket.id)).map((ticket) => ticket.id);
    gaps.push({
      id: "cloud-sessions",
      cause: `${String(teleport.size)} cloud session${teleport.size === 1 ? "" : "s"} left neither a session record nor a transcript: only their commits are known. Teleporting one brings its transcript to this device (its compacted part excepted).`,
      metrics: ["humanMessagesPerTicket", "activeTime", "apiEquivalentCost", "autonomy"],
      tickets: ids.length,
      ticketIds: ids,
      fix: { kind: "command", command: [...teleport.keys()].sort().map((id) => `claude --teleport ${id}`).join("\n") },
      teleport: [...teleport.keys()].sort(),
    });
  }

  // The Action.
  const [lastActionRun] = data.actionRuns;
  if (lastActionRun?.conclusion === "startup_failure") {
    gaps.push({
      id: "action-blocked",
      cause: "The agentic-metrics workflow could not start on its latest run: the repo (or its organisation) allows only selected actions.",
      metrics: ACTION_METRICS,
      fix: {
        kind: "settings",
        text: `Allow ${ACTION_PATTERN} under Settings > Actions > General > Actions permissions > Allow specified actions and reusable workflows.`,
      },
    });
  } else if (lastActionRun === undefined && checkout?.action === "missing") {
    gaps.push({
      id: "action-missing",
      cause: "The agentic-metrics workflow is not installed: nothing adds missing issue links to PRs, labels regressions or asks for estimates.",
      metrics: ACTION_METRICS,
      fix: { kind: "command", command: INIT },
    });
  } else if (lastActionRun === undefined && checkout?.action === "not-committed") {
    gaps.push({
      id: "action-not-committed",
      cause: "The agentic-metrics workflow is installed but not committed, so it never runs.",
      metrics: ACTION_METRICS,
      fix: { kind: "command", command: COMMIT_ACTION },
    });
  }

  // Conventions.
  perTicket(
    {
      id: "not-labelled-ready",
      cause: `Tickets whose issue never got the ready label (${config.readyLabel}): their lead time starts when the issue was created.`,
      metrics: ["leadTime"],
      fix: {
        kind: "convention",
        text: `Add the "${config.readyLabel}" label to an issue when it is ready to work on, or set "readyLabel" in ${CONFIG_FILE} to the label you already use.`,
      },
    },
    work.tickets.filter((ticket) => ticket.issue && !ticket.issue.labelled.some((event) => event.label === config.readyLabel)).map((ticket) => ticket.id),
  );
  if (data.regressions.length === 0 && work.tickets.length > 0) {
    gaps.push({
      id: "no-regressions-declared",
      cause: `No issue is labelled "${REGRESSION_LABEL}": regressions are counted only when someone traces them.`,
      metrics: ["regressionRate"],
      fix: {
        kind: "convention",
        text: `When a bug comes from a delivered ticket, write a line "caused-by: #N" in its issue; the agentic-metrics workflow then labels it "${REGRESSION_LABEL}".`,
      },
    });
  }

  // CI.
  const { mainWorkflow } = work.ci;
  if (config.ciWorkflow !== undefined && mainWorkflow === undefined) {
    gaps.push({
      id: "ci-workflow-not-found",
      cause: `The configured ciWorkflow (${config.ciWorkflow}) has no run: first-run CI results are unknown.`,
      metrics: MAIN_CI_METRICS,
      fix: { kind: "config", text: `Set "ciWorkflow" in ${CONFIG_FILE} to the path, file name or name of the workflow that checks pull requests.` },
    });
  } else if (config.ciWorkflow === undefined && mainWorkflow !== undefined) {
    gaps.push({
      id: "ci-workflow-guessed",
      cause: `The main CI workflow was guessed as the one that ran on the most PRs (${mainWorkflow}).`,
      metrics: MAIN_CI_METRICS,
      fix: { kind: "config", text: `Set "ciWorkflow": "${mainWorkflow}" in ${CONFIG_FILE}, or the workflow that is the main check if that one is not.` },
    });
  } else if (config.ciWorkflow === undefined && work.tickets.length > 0) {
    gaps.push({
      id: "no-ci",
      cause: "No workflow ran on pull requests: CI metrics are unknown.",
      metrics: [...MAIN_CI_METRICS, "fixCycles"],
      fix: { kind: "unfixable", reason: "CI is read from GitHub Actions runs on pull requests; the repo has none." },
    });
  }

  // A stable sort: gaps of the same rank keep the order above.
  const rank = (gap: Gap) => (gap.tickets === undefined ? Infinity : gap.tickets);
  return gaps.sort((a, b) => rank(b) - rank(a));
}

/** Gaps as an anonymized dataset keeps them: counts, no ticket ids. */
export function anonymizeGaps(gaps: Gap[]): Gap[] {
  return gaps.map((gap) => {
    const kept = { ...gap };
    delete kept.ticketIds;
    delete kept.teleport;
    // A cloud session's id is no ticket, but it is a link into the account that ran it.
    if (kept.id === "cloud-sessions") kept.fix = { kind: "command", command: "claude --teleport <session id>, for each of the repo's cloud sessions (run doctor where the repo is not anonymized)" };
    return kept;
  });
}
