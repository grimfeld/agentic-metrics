// Links Claude Code sessions to tickets. A session (main or sub-agent) is
// linked by the first of these that names delivered work:
//   1. its git branch: among the branches its lines ran on that are a ticket
//      PR's head or carry an issue number (the config's branch regex), the
//      one it ran on most. Sub-agents start on `worktree-agent-<id>` or a
//      detached `HEAD` and check out the ticket branch later, so a single
//      line's branch is not enough;
//   2. the name of the worktree in its working folder (`.claude/worktrees/<name>`),
//      read with the same regex;
//   3. the PRs of this repo it created or touched (`pr-link` lines);
//   4. for a sub-agent, the session that spawned it.
// A number names an issue that is a ticket, else a PR, which stands for its
// ticket(s). A PR delivering several issues links the session to each.
//
// A session whose branch or worktree names work that isn't delivered (still
// open, or not merged into the default branch) counts nowhere. A session
// naming no work at all (the default branch: grilling, planning,
// orchestration) is repo-level orchestration.
import { issueNumberFromBranch } from "../branch.ts";
import type { Config } from "../config.ts";
import type { LinkedWork, Ticket } from "../linker.ts";
import type { Session } from "./load.ts";

/** Named work that is not delivered. */
const ELSEWHERE = "elsewhere";
type Resolution = Ticket[] | typeof ELSEWHERE | undefined;

export function linkSessions(work: LinkedWork, sessions: Session[], config: Config, repo: string): LinkedWork {
  const byPr = new Map<number, Ticket[]>();
  const byHead = new Map<string, Ticket[]>();
  const byIssue = new Map<number, Ticket>();
  for (const ticket of work.tickets) {
    for (const pr of ticket.pullRequests) {
      byPr.set(pr.number, [...(byPr.get(pr.number) ?? []), ticket]);
      byHead.set(pr.headRefName, [...(byHead.get(pr.headRefName) ?? []), ticket]);
    }
    if (ticket.issue) byIssue.set(ticket.issue.number, ticket);
  }

  const byNumber = (number: number): Resolution => {
    const ticket = byIssue.get(number);
    return ticket ? [ticket] : (byPr.get(number) ?? ELSEWHERE);
  };
  const byName = (name: string): Resolution => {
    const head = byHead.get(name);
    if (head) return head;
    const number = issueNumberFromBranch(name, config.branchRegex);
    return number === undefined ? undefined : byNumber(number);
  };

  const own = (session: Session): Resolution => {
    const branch = [...session.branches]
      .map(([name, lines]) => ({ resolution: byName(name), lines }))
      .filter(({ resolution }) => resolution !== undefined)
      .sort((a, b) => b.lines - a.lines)[0];
    if (branch) return branch.resolution;

    for (const cwd of session.cwds) {
      const worktree = /[/\\]\.claude[/\\]worktrees[/\\]([^/\\]+)/.exec(cwd)?.[1];
      const resolution = worktree === undefined ? undefined : byName(worktree);
      if (resolution !== undefined) return resolution;
    }

    const linked = session.prLinks
      .filter((link) => link.repository.toLowerCase() === repo.toLowerCase())
      .flatMap((link) => byPr.get(link.number) ?? []);
    return linked.length > 0 ? [...new Set(linked)] : undefined;
  };

  const parents = new Map<string, Resolution>();
  for (const session of sessions) if (session.agentId === undefined) parents.set(session.sessionId, own(session));

  const ticketSessions = new Map<Ticket, Session[]>();
  const orchestration: Session[] = [];
  for (const session of sessions) {
    const resolution = session.agentId === undefined ? parents.get(session.sessionId) : (own(session) ?? parents.get(session.sessionId));
    if (resolution === undefined) orchestration.push(session);
    else if (resolution !== ELSEWHERE) for (const ticket of resolution) ticketSessions.set(ticket, [...(ticketSessions.get(ticket) ?? []), session]);
  }

  return {
    ...work,
    tickets: work.tickets.map((ticket) => ({ ...ticket, sessions: ticketSessions.get(ticket) ?? [] })),
    transcripts: { sessions: sessions.length, orchestration },
  };
}
