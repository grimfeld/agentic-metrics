// The text conventions people write on issues (spec: "Regression", "Estimate").
// One definition shared by the CLI (which measures them) and the GitHub Action
// (which reminds about them), so both read the same lines the same way.

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

/** `estimate: 2d` at the start of a line; decimals allowed; `h`, `d` or `w`. */
const ESTIMATE = /^[ \t]*estimate:[ \t]*(\d+(?:\.\d+)?)[ \t]*([hdw])\b/im;
const UNIT_HOURS = { h: 1, d: 24, w: 168 } as const;

/** The estimate an `estimate:` line in `text` gives, in hours (days and weeks are calendar time). */
export function estimateHours(text: string | null | undefined): number | undefined {
  const match = ESTIMATE.exec(text ?? "");
  if (!match) return undefined;
  const unit = (match[2] ?? "h").toLowerCase() as keyof typeof UNIT_HOURS;
  return Number(match[1]) * UNIT_HOURS[unit];
}
