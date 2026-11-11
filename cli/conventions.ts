// The conventions shared by the CLI (which measures them), `init` (which sets
// them up) and the GitHub Action (which reminds about them): the lines people
// write on issues (spec: "Regression", "Estimate"), the regression label and
// the Action's workflow. One definition, so they read them the same way.

/** The workflow `init` installs to run the Action. It reminds and labels: it is never CI. */
export const ACTION_WORKFLOW = ".github/workflows/agentic-metrics.yml";

/**
 * The label that marks an issue as a regression: `collect` counts only issues
 * carrying it, `init` creates it, and the Action adds it to an issue that gains
 * a `caused-by: #N` line.
 */
export const REGRESSION_LABEL = "regression";

/**
 * A line starting with `caused-by: #N`, any case. A mention mid-line (such as
 * the Action's question) is not one, and nor is `owner/repo#N`: work in another
 * repo cannot be traced to a ticket here.
 */
const CAUSED_BY = /^[ \t]*caused-by:[ \t]*#(\d+)\b/gim;

/** Issue numbers named by `caused-by: #N` lines in `texts`, in order, without repeats. */
export function causedBy(texts: readonly (string | null | undefined)[]): number[] {
  const numbers = texts.flatMap((text) => [...(text ?? "").matchAll(CAUSED_BY)].map((match) => Number(match[1])));
  return [...new Set(numbers)];
}

/** The kinds of change (GLOSSARY.md), each a label `kind:<kind>` that `init` creates. */
export const KINDS = ["feature", "fix", "refactor", "chore", "docs", "test"] as const;
export type Kind = (typeof KINDS)[number];

/**
 * A ticket's kind of change, from its `kind:*` labels: its issue's, else its
 * PRs'. `unknown` when none says; `conflicting` when they name two kinds, which
 * count under neither.
 */
export function kindOf(issueLabels: readonly string[] | undefined, prLabels: readonly string[]): Kind | "unknown" | "conflicting" {
  const isKind = (name: string | undefined): name is Kind => name !== undefined && (KINDS as readonly string[]).includes(name);
  const kinds = (labels: readonly string[]): Kind[] => [
    ...new Set(
      labels.flatMap((label) => {
        const kind = /^kind:(\w+)$/i.exec(label.trim())?.[1]?.toLowerCase();
        return isKind(kind) ? [kind] : [];
      }),
    ),
  ];
  const own = kinds(issueLabels ?? []);
  const found = own.length > 0 ? own : kinds(prLabels);
  if (found.length === 0) return "unknown";
  return found.length === 1 && found[0] !== undefined ? found[0] : "conflicting";
}

/** `estimate: 2d` at the start of a line; decimals allowed; `h`, `d` or `w`. */
const ESTIMATE = /^[ \t]*estimate:[ \t]*(\d+(?:\.\d+)?)[ \t]*([hdw])\b/im;
// An estimate is of working time, as active time is: a day is 8 hours of work and a week 5 such days.
const UNIT_HOURS = { h: 1, d: 8, w: 40 } as const;

/** The estimate an `estimate:` line in `text` gives, in hours of work (a day is 8 h, a week 40 h). */
export function estimateHours(text: string | null | undefined): number | undefined {
  const match = ESTIMATE.exec(text ?? "");
  if (!match) return undefined;
  const unit = (match[2] ?? "h").toLowerCase() as keyof typeof UNIT_HOURS;
  return Number(match[1]) * UNIT_HOURS[unit];
}
