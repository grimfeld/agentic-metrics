// Turns the transcript source's parsed JSON lines into the CLI's session
// model. This is where transcript content stops: a Session holds derived
// numbers, plus the branches, working folders and PR links that linking needs
// and that no metric publishes. No message text, account or organisation
// identifier (session-owner, credential_org, session_context's userEmail) or
// request payload (api-request, api-request-blob) is kept.
//
// The format is undocumented and changes between Claude Code versions, so
// every field is read leniently and unknown line types are ignored.
//
// A later metric that needs more (tokens per model, Agent spawns) adds a
// derived field here. Token usage must be deduplicated by `message.id`: one
// API response is written as one line per content block, each repeating the
// same `usage`.
import type { TranscriptFile } from "./source.ts";

export interface PrLink {
  /** `owner/name` */
  repository: string;
  number: number;
}

export interface Session {
  /** The main session's id; a sub-agent carries its parent's. Never published. */
  sessionId: string;
  /** Set for a sub-agent. Never published. */
  agentId: string | undefined;
  /** How many lines ran on each git branch (`HEAD` when detached). */
  branches: Map<string, number>;
  /** The working folders its lines ran in, in order of first use. */
  cwds: string[];
  /** PRs it created or touched (`pr-link` lines). */
  prLinks: PrLink[];
  /**
   * The uuids of its human messages: typed prompts, not slash commands, shell
   * escapes, tool results or approvals, interrupts, notifications, messages
   * from other agents, or injected (meta) lines. Uuids let a message written
   * twice (a resumed session repeats its history) count once.
   */
  humanMessages: string[];
  /** Active time: the gaps between its lines, each capped at IDLE_CAP_MS. */
  activeMs: number;
}

/** A gap between two lines longer than this counts as this much: the rest is idle. */
export const IDLE_CAP_MS = 5 * 60 * 1000;

export function loadSessions(files: TranscriptFile[]): Session[] {
  return files.map((file) => {
    const branches = new Map<string, number>();
    const cwds = new Set<string>();
    const prLinks: PrLink[] = [];
    const humanMessages: string[] = [];
    const times: number[] = [];
    let sessionId: string | undefined;

    for (const raw of file.lines) {
      if (!isRecord(raw)) continue;
      sessionId ??= str(raw["sessionId"]);
      const time = Date.parse(str(raw["timestamp"]) ?? "");
      if (Number.isFinite(time)) times.push(time);
      const branch = str(raw["gitBranch"]);
      if (branch) branches.set(branch, (branches.get(branch) ?? 0) + 1);
      const cwd = str(raw["cwd"]);
      if (cwd) cwds.add(cwd);
      if (raw["type"] === "pr-link") {
        const repository = str(raw["prRepository"]);
        const number = raw["prNumber"];
        if (repository && typeof number === "number") prLinks.push({ repository, number });
      }
      const uuid = str(raw["uuid"]);
      if (uuid && isHumanMessage(raw)) humanMessages.push(uuid);
    }

    times.sort((a, b) => a - b);
    let activeMs = 0;
    for (let i = 1; i < times.length; i++) activeMs += Math.min((times[i] ?? 0) - (times[i - 1] ?? 0), IDLE_CAP_MS);

    return {
      sessionId: sessionId ?? file.session,
      agentId: file.agentId,
      branches,
      cwds: [...cwds],
      prLinks,
      humanMessages: [...new Set(humanMessages)],
      activeMs,
    };
  });
}

/** Content a human typed but that is a command, a shell escape or an interrupt, not a message. */
const NOT_A_MESSAGE = /^(<command-|<local-command-|<bash-|\[Request interrupted)/;

function isHumanMessage(line: Record<string, unknown>): boolean {
  if (line["type"] !== "user" || line["isSidechain"] === true || line["isMeta"] === true || line["isCompactSummary"] === true) return false;
  if ("toolUseResult" in line) return false;
  const message = line["message"];
  const content = isRecord(message) ? message["content"] : undefined;
  const text = typeof content === "string" ? content : Array.isArray(content) ? textOf(content) : undefined;
  if (text === undefined) return false; // A tool result, or nothing typed.

  const origin = line["origin"];
  if (isRecord(origin)) return origin["kind"] === "human" && !NOT_A_MESSAGE.test(text);
  // Versions before `origin`: a plain prompt, never a tag Claude Code injects.
  return !text.startsWith("<") && !NOT_A_MESSAGE.test(text);
}

/** The first text block of a content array, unless it holds a tool result. */
function textOf(blocks: unknown[]): string | undefined {
  if (blocks.some((block) => isRecord(block) && block["type"] === "tool_result")) return undefined;
  const text = blocks.find((block) => isRecord(block) && block["type"] === "text");
  return isRecord(text) ? str(text["text"]) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
