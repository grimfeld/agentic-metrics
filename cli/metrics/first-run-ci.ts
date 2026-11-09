import { firstResult } from "../ci.ts";
import { escapeHtml } from "./html.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { formatPercent, percent, share } from "./stats.ts";

export interface FirstRunCiRate {
  /** Share of PRs with a first CI result whose first result passed, 0 to 1. */
  rate: number;
  passed: number;
  /** PRs with a first CI result. */
  pullRequests: number;
  /** The main check workflow's path. Absent once anonymized: a workflow's name can name the repo or client. */
  workflow?: string;
}

export const firstRunCiRate: Metric<FirstRunCiRate> = {
  id: "firstRunCiRate",
  name: "First-run CI rate",

  compute({ tickets, ci }) {
    const results = new Map(tickets.flatMap((ticket) => ticket.pullRequests).map((pr) => [pr, firstResult(pr, ci)]));
    const covered = tickets.filter((ticket) => ticket.pullRequests.some((pr) => results.get(pr) !== undefined));
    const coverage = { tickets: covered.length, of: tickets.length };
    const judged = [...results.values()].filter((result) => result !== undefined);
    if (judged.length === 0 || ci.mainWorkflow === undefined) return { value: UNKNOWN, coverage };
    const passed = judged.filter((result) => result === "passed").length;
    return {
      value: { rate: share(passed, judged.length), passed, pullRequests: judged.length, workflow: ci.mainWorkflow },
      coverage,
    };
  },

  anonymize: ({ rate, passed, pullRequests }) => ({ rate, passed, pullRequests }),

  figure: { label: "of PRs", of: ({ rate }) => percent(rate), format: formatPercent },

  sentence: ({ rate, passed, pullRequests }) =>
    `${formatPercent(percent(rate))} of pull requests passed CI on their first run (${String(passed)} of ${String(pullRequests)})`,

  headline({ rate, passed, pullRequests }) {
    return `${formatPercent(percent(rate))} <small>${String(passed)} of ${String(pullRequests)} PRs</small>`;
  },

  section({ rate, passed, pullRequests, workflow }) {
    return `<p><strong>${formatPercent(percent(rate))}</strong> of PRs passed CI on the first try: ${String(passed)} of ${String(pullRequests)}${workflow === undefined ? "" : `, judged on <code>${escapeHtml(workflow)}</code>`}.</p>`;
  },

  methodology: {
    definition:
      "The share of PRs whose first CI result passed. The first result is the conclusion of the <em>first attempt</em> of the first run of the repo's main check workflow on the PR: a <code>pull_request</code> run on the PR's head branch, created between the PR's opening and its merge. A run that gave no result (cancelled, skipped) is passed over for the next one. The main check workflow is set per repo (<code>ciWorkflow</code>); unset, it is the workflow that ran on the most PRs. Re-runs: GitHub keeps a re-run under the same run, with the same id and creation time, and its listing shows only the latest attempt. The tool reads the first attempt of every re-run run (<code>attempts/1</code>), so passing on a re-run still counts as a failed first run. This was checked against real re-runs on GitHub.",
    limits:
      "Only <code>pull_request</code> runs count: CI that runs on push alone gives no result. A PR with no run of the main workflow is left out, and so is a ticket with no such PR (tickets delivered only through a batch, for one). GitHub's own <code>dynamic</code> runs (CodeQL, Dependabot) and the agentic-metrics workflow <code>init</code> installs are never CI.",
  },
};
