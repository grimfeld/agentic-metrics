// Session records: the counts a session leaves, as a `Session-Record:` trailer,
// on the commits it makes (`recorder.mjs`, docs/adr/0001). They stand in for a
// transcript that was not cached: work done on another device or in a cloud
// session.
//
// A record's counters are cumulative over its session, and one session can
// work on several tickets. So what a commit adds is the difference from the
// same session's previous commit, and that difference belongs to whoever owns
// the commit: the ticket it is a commit of, or, for a merge and for a commit no
// ticket owns, nobody: it is orchestration.
//
// Each session's share of a ticket (or of orchestration) becomes a `Session`,
// marked `recorded`, so that every metric that reads sessions reads records
// too. A session whose transcript was loaded is read from the transcript: its
// records are dropped.
import { createHash } from "node:crypto";
import type { Commit } from "./github/load.ts";
import { ownCommits, type LinkedWork, type Ticket } from "./linker.ts";
import type { AgentSpawn, Session, Stretch } from "./transcripts/load.ts";

export interface SessionRecord {
  /** The session's opaque key; a sub-agent has its own. Never published. */
  key: string;
  /** The session's active time when the commit was made. */
  activeMs: number;
  /** Its human messages so far. */
  human: number;
  /** The sub-agents it had spawned so far. */
  agents: number;
  startedAt: Date | undefined;
  /** Set for a sub-agent: its parent session's key. */
  parent: string | undefined;
  /** The random id of the device the session ran on (`d=`); undefined in records written before it. */
  device?: string | undefined;
}

const LINE = /^[ \t]*session-record:[ \t]*v1[ \t]+(.*)$/gim;

/** The session records in a commit message's body: one per session, its highest counters when a session wrote several. */
export function parseRecords(body: string): SessionRecord[] {
  const byKey = new Map<string, SessionRecord>();
  for (const [, rest = ""] of body.matchAll(LINE)) {
    const fields = new Map(rest.trim().split(/\s+/).map((field) => field.split("=", 2) as [string, string | undefined]));
    const key = fields.get("k");
    const count = (name: string) => (/^\d+$/.test(fields.get(name) ?? "") ? Number(fields.get(name)) : undefined);
    const active = count("active");
    // A line that is not a record as the recorder writes it is ignored whole.
    if (key === undefined || !/^[0-9a-f]{6,64}$/.test(key) || active === undefined) continue;
    const started = Date.parse(fields.get("started") ?? "");
    const parent = fields.get("parent");
    const device = fields.get("d");
    const record: SessionRecord = {
      key,
      activeMs: active * 1000,
      human: count("human") ?? 0,
      agents: count("agents") ?? 0,
      startedAt: Number.isFinite(started) ? new Date(started) : undefined,
      parent: parent !== undefined && /^[0-9a-f]{6,64}$/.test(parent) ? parent : undefined,
      ...(device !== undefined && /^[0-9a-f]{8}$/.test(device) ? { device } : {}),
    };
    const seen = byKey.get(key);
    if (!seen || record.activeMs > seen.activeMs) byKey.set(key, record);
  }
  return [...byKey.values()];
}

/** The key the recorder gives a session, or one of its sub-agents: the same hash, so a transcript and its records match. */
export function recordKey(sessionId: string, agentId?: string): string {
  const name = agentId === undefined ? sessionId : `${sessionId}:${agentId}`;
  return createHash("sha256").update(`agentic-metrics:${name}`).digest("hex").slice(0, 12);
}

/** What one commit added to its session's counters. */
interface Step {
  record: SessionRecord;
  commit: Commit;
  activeMs: number;
  human: number;
  agents: number;
  /** The session's counters before this commit: names what this commit added. */
  humanBefore: number;
  agentsBefore: number;
  /** The session's previous commit, which the time this one added cannot precede. */
  after: number | undefined;
}

const ORCHESTRATION = "orchestration" as const;
type Owner = Ticket | typeof ORCHESTRATION;

/**
 * `work` with its session records read: each ticket gains the recorded
 * sessions of its commits, and orchestration those of merges and of commits no
 * ticket owns. `loaded` are the sessions read from transcripts, which win.
 */
export function linkRecords(work: LinkedWork, loaded: readonly Session[]): LinkedWork {
  const fromTranscripts = new Set(loaded.map((session) => recordKey(session.sessionId, session.agentId)));

  // Who owns each commit: the tickets it is a commit of. A merge is nobody's work.
  const owners = new Map<string, Ticket[]>();
  for (const ticket of work.tickets) {
    for (const commit of ownCommits(ticket)) {
      if (commit.parents.length > 1 || commit.oid === "") continue;
      owners.set(commit.oid, [...(owners.get(commit.oid) ?? []), ticket]);
    }
  }
  const commits = new Map<string, Commit>();
  const pullRequests = [...new Set([...work.tickets.flatMap((ticket) => [...ticket.pullRequests, ...ticket.integrationPullRequests]), ...work.pullRequests, ...work.integrationPullRequests])];
  for (const commit of pullRequests.flatMap((pr) => pr.commits)) if (commit.oid !== "" && commit.records.length > 0) commits.set(commit.oid, commit);

  const bySession = new Map<string, { record: SessionRecord; commit: Commit }[]>();
  for (const commit of commits.values()) {
    for (const record of commit.records) {
      if (fromTranscripts.has(record.key)) continue;
      bySession.set(record.key, [...(bySession.get(record.key) ?? []), { record, commit }]);
    }
  }

  // Per owner (a ticket, or orchestration) and session: the steps that session's commits added there.
  const shares = new Map<Owner, Map<string, Step[]>>();
  for (const [key, entries] of bySession) {
    entries.sort((a, b) => a.record.activeMs - b.record.activeMs || (a.commit.authoredAt?.getTime() ?? 0) - (b.commit.authoredAt?.getTime() ?? 0));
    let before: { record: SessionRecord; commit: Commit } | undefined;
    for (const entry of entries) {
      const step: Step = {
        ...entry,
        activeMs: Math.max(0, entry.record.activeMs - (before?.record.activeMs ?? 0)),
        human: Math.max(0, entry.record.human - (before?.record.human ?? 0)),
        agents: Math.max(0, entry.record.agents - (before?.record.agents ?? 0)),
        humanBefore: before?.record.human ?? 0,
        agentsBefore: before?.record.agents ?? 0,
        after: before?.commit.authoredAt?.getTime(),
      };
      before = entry;
      const owned: Owner[] = owners.get(entry.commit.oid) ?? [ORCHESTRATION];
      for (const owner of owned) {
        const sessions = shares.get(owner) ?? new Map<string, Step[]>();
        shares.set(owner, sessions.set(key, [...(sessions.get(key) ?? []), step]));
      }
    }
  }

  const recorded = (owner: Owner): Session[] => claimSpawns([...(shares.get(owner) ?? [])].map(([key, steps]) => sessionOf(key, steps)));
  const orchestration = recorded(ORCHESTRATION);
  const tickets = work.tickets.map((ticket) => (shares.has(ticket) ? { ...ticket, sessions: [...ticket.sessions, ...recorded(ticket)] } : ticket));
  const added = tickets.reduce((sum, ticket, index) => sum + ticket.sessions.length - (work.tickets[index]?.sessions.length ?? 0), 0) + orchestration.length;
  return {
    ...work,
    tickets,
    transcripts: { sessions: work.transcripts.sessions + added, orchestration: [...work.transcripts.orchestration, ...orchestration] },
  };
}

/** What a session's commits added to one owner, as a session the metrics can read. */
function sessionOf(key: string, steps: readonly Step[]): Session {
  const id = `record:${key}`;
  const record = steps[0]?.record;
  const activity: Stretch[] = [];
  for (const step of steps) {
    const end = step.commit.authoredAt?.getTime();
    if (end === undefined || step.activeMs === 0) continue;
    // The time a commit added was spent before it, and after the session's start and its previous commit.
    const floor = Math.max(step.after ?? -Infinity, step.record.startedAt?.getTime() ?? -Infinity);
    activity.push([Math.max(end - step.activeMs, Math.min(floor, end)), end]);
  }
  activity.sort((a, b) => a[0] - b[0]);
  const spawns: AgentSpawn[] = steps.flatMap((step) => Array.from({ length: step.agents }, (_, index) => ({ agentId: `${id}:spawn:${String(step.agentsBefore + index + 1)}`, model: undefined })));
  return {
    sessionId: id,
    // A sub-agent's record: counted as a sub-agent, under its own key.
    agentId: record?.parent === undefined ? undefined : id,
    recorded: {
      parent: record?.parent === undefined ? undefined : `record:${record.parent}`,
      device: steps.find((step) => step.record.device !== undefined)?.record.device,
      cloud: steps.some((step) => step.commit.cloudSession),
    },
    branches: new Map(),
    cwds: [],
    prLinks: [],
    humanMessages: steps.flatMap((step) => Array.from({ length: step.human }, (_, index) => `${id}:human:${String(step.humanBefore + index + 1)}`)),
    activeMs: activity.reduce((sum, [from, to]) => sum + (to - from), 0),
    activity,
    startedAt: activity[0] ? new Date(activity[0][0]) : (record?.startedAt ?? steps[0]?.commit.authoredAt),
    responses: [],
    spawns,
  };
}

/**
 * A sub-agent's record and its parent's count of sub-agents can name the same
 * sub-agent. Where both are on one owner, the sub-agent takes one of the
 * parent's spawns as its id, so it counts once.
 */
function claimSpawns(sessions: Session[]): Session[] {
  const free = new Map<string, string[]>();
  for (const session of sessions) if (session.agentId === undefined) free.set(session.sessionId, session.spawns.map((spawn) => spawn.agentId));
  return sessions.map((session) => {
    const parent = session.recorded?.parent;
    const spawn = parent === undefined ? undefined : free.get(parent)?.shift();
    return spawn === undefined ? session : { ...session, agentId: spawn };
  });
}

/** How many tickets' sessions come from each source: a ticket with any transcript counts under transcripts. */
export function sessionSources(tickets: readonly Ticket[]): { transcripts: number; records: number } {
  const measured = tickets.filter((ticket) => ticket.sessions.length > 0);
  const transcripts = measured.filter((ticket) => ticket.sessions.some((session) => !session.recorded)).length;
  return { transcripts, records: measured.length - transcripts };
}
