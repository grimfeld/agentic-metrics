import type { PullRequest } from "../github/load.ts";
import { escapeHtml } from "./html.ts";
import type { Metric } from "./metric.ts";
import { UNKNOWN } from "./metric.ts";
import { round } from "./stats.ts";

export interface TestRatio {
  testLinesAdded: number;
  productionLinesAdded: number;
  /** Test lines added per production line added, to two decimals. */
  ratio: number;
  /** Each covered ticket's lines over its own PRs, in delivery order. Absent once anonymized. */
  tickets?: { ticket: string; testLinesAdded: number; productionLinesAdded: number }[];
}

type Kind = "test" | "production" | "other";

const TEST_FOLDERS = new Set(["test", "tests", "__tests__", "spec", "specs", "e2e", "__mocks__", "testdata"]);
const TEST_FILE = /(\.(test|spec)\.[^./]+|_test\.[^./]+|^test_[^/]*\.py)$/;
const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "composer.lock",
  "poetry.lock",
  "uv.lock",
  "go.sum",
]);
const DOCS = /\.(md|mdx|markdown|rst|txt|adoc)$/i;

/** Test code, production code, or neither (documentation and lockfiles). */
function classify(path: string): Kind {
  const segments = path.split("/");
  const name = segments.at(-1) ?? path;
  if (segments.slice(0, -1).some((segment) => TEST_FOLDERS.has(segment)) || TEST_FILE.test(name)) return "test";
  if (LOCKFILES.has(name) || DOCS.test(name)) return "other";
  return "production";
}

/** Lines added to test and to production files over `pullRequests`, each PR counted once. */
function linesAdded(pullRequests: ReadonlySet<PullRequest>): { testLinesAdded: number; productionLinesAdded: number } {
  let testLinesAdded = 0;
  let productionLinesAdded = 0;
  for (const file of [...pullRequests].flatMap((pr) => pr.files)) {
    const kind = classify(file.path);
    if (kind === "test") testLinesAdded += file.additions;
    if (kind === "production") productionLinesAdded += file.additions;
  }
  return { testLinesAdded, productionLinesAdded };
}

export const testRatio: Metric<TestRatio> = {
  id: "testRatio",
  name: "Test lines per production line",

  compute({ tickets }) {
    const covered = tickets.filter((ticket) => ticket.pullRequests.length > 0 && ticket.pullRequests.every((pr) => pr.filesComplete));
    const coverage = { tickets: covered.length, of: tickets.length };
    const { testLinesAdded, productionLinesAdded } = linesAdded(new Set<PullRequest>(covered.flatMap((ticket) => ticket.pullRequests)));
    if (productionLinesAdded === 0) return { value: UNKNOWN, coverage };
    const ratio = round(testLinesAdded / productionLinesAdded, 2);
    const perTicket = covered.map((ticket) => ({ ticket: ticket.id, ...linesAdded(new Set(ticket.pullRequests)) }));
    return { value: { testLinesAdded, productionLinesAdded, ratio, tickets: perTicket }, coverage };
  },

  // Per-ticket rows name tickets: an anonymized dataset keeps the totals only.
  anonymize: ({ testLinesAdded, productionLinesAdded, ratio }) => ({ testLinesAdded, productionLinesAdded, ratio }),

  figure: { label: "ratio", of: ({ ratio }) => ratio, format: String },

  sentence: ({ testLinesAdded, productionLinesAdded, ratio }) =>
    `${String(ratio)} test lines written per production line (${String(testLinesAdded)} test lines for ${String(productionLinesAdded)} production lines)`,

  section({ testLinesAdded, productionLinesAdded, ratio, tickets }) {
    const summary = `<p><strong>${String(ratio)}</strong> test lines added per production line: ${String(testLinesAdded)} test lines for ${String(productionLinesAdded)} production lines.</p>`;
    if (!tickets?.length) return summary;
    const rows = tickets
      .map((t) => `<tr><td>${escapeHtml(t.ticket)}</td><td>${String(t.testLinesAdded)}</td><td>${String(t.productionLinesAdded)}</td></tr>`)
      .join("");
    return `${summary}<table><thead><tr><th>Ticket</th><th>Test lines</th><th>Production lines</th></tr></thead><tbody>${rows}</tbody></table>`;
  },

  methodology: {
    definition:
      "Lines added to test files divided by lines added to production files, over the PRs merged into the default branch, each PR counted once. A test file sits under a <code>test</code>, <code>tests</code>, <code>__tests__</code>, <code>spec</code>, <code>specs</code>, <code>e2e</code>, <code>__mocks__</code> or <code>testdata</code> folder, or is named <code>*.test.*</code>, <code>*.spec.*</code>, <code>*_test.*</code> or <code>test_*.py</code>. Documentation (<code>.md</code>, <code>.txt</code> and the like) and lockfiles count as neither; every other file is production.",
    limits:
      "Classified by path only, so test fixtures count as test lines and generated files as production. GitHub lists at most 100 files per PR: a ticket with a PR changing more is left out. A ticket delivered only through an integration PR is left out too: the commits credited to it (see Autonomy level) carry no per-file lines. Unknown when no production line was added.",
  },
};
