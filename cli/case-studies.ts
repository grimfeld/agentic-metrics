// Case studies. `collect` flags candidates from the linked work (largest
// ticket, fewest human messages for its size, largest deletion, a regression
// caught and fixed) and writes a Markdown draft for each, from its numbers and
// its ticket and PR descriptions, into `case-studies/<owner>/<repo>/`. A draft
// starts `approved: false`; the human edits it, sets `approved: true` and
// commits it. `report` renders approved drafts only, and only for repos
// published `full`: an `anonymized` or `none` repo gets no candidates, no
// drafts and no case studies.
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LinkedWork, Ticket } from "./linker.ts";
import { humanMessagesPerTicket } from "./metrics/human-messages.ts";
import { UNKNOWN } from "./metrics/metric.ts";
import { regressionRate } from "./metrics/regression-rate.ts";
import { sizeOf } from "./metrics/size.ts";

export const CASE_STUDIES_DIR = "case-studies";

/** The criteria, in the order a candidate lists them. */
export const CRITERIA = [
  "largest ticket",
  "fewest human messages for its size",
  "largest deletion",
  "regression caught and fixed",
] as const;

export type Criterion = (typeof CRITERIA)[number];

export interface CaseStudyCandidate {
  ticket: string;
  criteria: Criterion[];
}

/** What a draft is made from: the per-ticket figures the metrics compute. */
interface Facts {
  diffLines: Map<Ticket, number>;
  messages: Map<string, number>;
  regressions: Map<string, { bug: number; fixed: boolean }[]>;
}

function factsOf(work: LinkedWork): Facts {
  const diffLines = new Map(work.tickets.filter((t) => t.pullRequests.length > 0).map((t) => [t, sizeOf(t).diffLines]));
  const human = humanMessagesPerTicket.compute(work).value;
  const messages = new Map(human === UNKNOWN ? [] : (human.perTicket ?? []).map((row) => [row.ticket, row.messages]));
  const fixed = new Set(work.regressions.filter((bug) => bug.fixed).map((bug) => bug.number));
  const rate = regressionRate.compute(work).value;
  const regressions = new Map(
    rate === UNKNOWN ? [] : (rate.perTicket ?? []).map((row) => [row.ticket, row.bugs.map((bug) => ({ bug, fixed: fixed.has(bug) }))]),
  );
  return { diffLines, messages, regressions };
}

/**
 * The ticket with the highest score, compared element by element; the
 * earliest delivered on a tie. None when no ticket has a score.
 */
function best(tickets: readonly Ticket[], score: (ticket: Ticket) => number[] | undefined): Ticket | undefined {
  let found: { ticket: Ticket; score: number[] } | undefined;
  for (const ticket of tickets) {
    const value = score(ticket);
    if (value !== undefined && (!found || higher(value, found.score))) found = { ticket, score: value };
  }
  return found?.ticket;
}

function higher(a: number[], b: number[]): boolean {
  const i = a.findIndex((value, index) => value !== b[index]);
  return i !== -1 && (a[i] ?? 0) > (b[i] ?? 0);
}

function netRemoved(ticket: Ticket): number {
  return ticket.pullRequests.reduce((total, pr) => total + pr.deletions - pr.additions, 0);
}

/** Case-study candidates in delivery order, each with the criteria it meets. */
export function selectCandidates(work: LinkedWork): CaseStudyCandidate[] {
  const { diffLines, messages, regressions } = factsOf(work);
  const picks: Record<Criterion, Ticket | undefined> = {
    "largest ticket": best(work.tickets, (t) => {
      const lines = diffLines.get(t);
      return lines === undefined ? undefined : [lines];
    }),
    // Fewest messages per line changed; on a tie, the larger ticket.
    "fewest human messages for its size": best(work.tickets, (t) => {
      const lines = diffLines.get(t);
      const count = messages.get(t.id);
      if (!lines || count === undefined) return undefined;
      return [-count / lines, lines];
    }),
    // The most lines removed net of lines added, when any ticket removed more than it added.
    "largest deletion": best(work.tickets, (t) => (netRemoved(t) > 0 ? [netRemoved(t)] : undefined)),
    "regression caught and fixed": work.tickets.find((t) => regressions.get(t.id)?.some((r) => r.fixed)),
  };
  return work.tickets.flatMap((ticket) => {
    const criteria = CRITERIA.filter((criterion) => picks[criterion] === ticket);
    return criteria.length ? [{ ticket: ticket.id, criteria }] : [];
  });
}

/** `#106` is `106.md`, `PR #136` is `pr-136.md`. */
export function draftFile(ticket: string): string {
  return `${ticket.replace(/^PR #/, "pr-").replace(/^#/, "")}.md`;
}

function ticketOfFile(file: string): string {
  const name = file.replace(/\.md$/, "");
  return /^pr-\d+$/.test(name) ? `PR #${name.slice(3)}` : /^\d+$/.test(name) ? `#${name}` : name;
}

const NOTABLE_INTERVENTION = /^[ \t]*Notable intervention:.*$/gim;

function hours(ticket: Ticket): string {
  if (!ticket.readyAt) return UNKNOWN;
  const value = Math.round((ticket.doneAt.getTime() - ticket.readyAt.getTime()) / 360_000) / 10;
  return `${String(value)} hours`;
}

/** The Markdown draft of a candidate, from its figures and its ticket and PR descriptions. */
export function draftCaseStudy(candidate: CaseStudyCandidate, work: LinkedWork): string {
  const ticket = work.tickets.find((t) => t.id === candidate.ticket);
  if (!ticket) throw new Error(`no delivered ticket ${candidate.ticket}`);
  const { messages, regressions } = factsOf(work);
  const size = sizeOf(ticket);
  const added = ticket.pullRequests.reduce((total, pr) => total + pr.additions, 0);
  const deleted = ticket.pullRequests.reduce((total, pr) => total + pr.deletions, 0);
  const source = ticket.issue ?? ticket.pullRequests[0];
  const bugs = regressions.get(ticket.id) ?? [];
  const interventions = ticket.pullRequests.flatMap((pr) => (pr.body.match(NOTABLE_INTERVENTION) ?? []).map((line) => line.trim()));

  const lines = [
    "---",
    "approved: false",
    "---",
    "",
    `# ${ticket.id} ${source?.title ?? ""}`.trimEnd(),
    "",
    `Draft written by \`agentic-metrics collect\`. Edit it, then set \`approved: true\` above to publish it in the report.`,
    "",
    `Candidate for: ${candidate.criteria.join(", ")}.`,
    "",
    "## The numbers",
    "",
    `- Size: ${String(size.diffLines)} lines changed (${String(added)} added, ${String(deleted)} deleted) in ${String(size.filesTouched)} files`,
    `- Lead time: ${hours(ticket)}`,
    `- Human messages: ${messages.has(ticket.id) ? String(messages.get(ticket.id)) : UNKNOWN}`,
    `- Regressions: ${bugs.length ? bugs.map((r) => `#${String(r.bug)} (${r.fixed ? "fixed" : "open"})`).join(", ") : "none traced"}`,
    `- Pull requests: ${ticket.pullRequests.map((pr) => `[#${String(pr.number)}](${pr.url})`).join(", ") || "none"}`,
  ];
  if (ticket.issue) {
    lines.push("", "## The ticket", "", `[${ticket.id}](${ticket.issue.url})`);
    if (ticket.issue.body.trim()) lines.push("", ticket.issue.body.trim());
  }
  for (const pr of ticket.pullRequests) {
    lines.push("", `## PR #${String(pr.number)} ${pr.title}`);
    const body = pr.body.replace(NOTABLE_INTERVENTION, "").trim();
    if (body) lines.push("", body);
  }
  if (interventions.length) lines.push("", "## Notable intervention", "", ...interventions.flatMap((line, i) => (i ? ["", line] : [line])));
  return `${lines.join("\n").replace(/\r\n/g, "\n")}\n`;
}

/**
 * Writes a draft for each candidate into `dir` (`<case-studies>/<repo>`),
 * leaving any draft already there as it is: it may hold the human's edits or
 * approval. Returns the files written.
 */
export async function writeDrafts(dir: string, candidates: CaseStudyCandidate[], work: LinkedWork): Promise<string[]> {
  const written: string[] = [];
  for (const candidate of candidates) {
    const path = join(dir, draftFile(candidate.ticket));
    if (existsSync(path)) continue;
    await mkdir(dir, { recursive: true });
    await writeFile(path, draftCaseStudy(candidate, work));
    written.push(path);
  }
  return written;
}

export interface CaseStudy {
  ticket: string;
  /** Its Markdown, front matter removed. */
  markdown: string;
}

/** Front matter between `---` lines at the top; approved only when it holds `approved: true`. */
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseCaseStudy(file: string, text: string): { approved: boolean; study: CaseStudy } {
  const front = FRONT_MATTER.exec(text);
  const approved = front !== null && /^approved:[ \t]*true[ \t]*$/m.test(front[1] ?? "");
  return { approved, study: { ticket: ticketOfFile(file), markdown: front ? text.slice(front[0].length) : text } };
}

/** The approved case studies in `dir` (`<case-studies>/<repo>`), by file name; none when it doesn't exist. */
export async function readApproved(dir: string): Promise<CaseStudy[]> {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((file) => file.endsWith(".md")).sort();
  const parsed = await Promise.all(files.map(async (file) => parseCaseStudy(file, await readFile(join(dir, file), "utf8"))));
  return parsed.filter(({ approved }) => approved).map(({ study }) => study);
}
