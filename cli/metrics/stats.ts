// Small helpers shared by metrics.

/** Nearest-rank percentile of a non-empty list. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? Number.NaN;
}

/** `12 h` under two days, `7.5 d` from there. */
export function formatHours(hours: number): string {
  return hours < 48 ? `${String(Math.round(hours * 10) / 10)} h` : `${String(Math.round((hours / 24) * 10) / 10)} d`;
}

/** `25 min` under an hour, then as `formatHours`: for durations that are often short. */
export function formatDuration(hours: number): string {
  return hours < 1 ? `${String(Math.round(hours * 60))} min` : formatHours(hours);
}

/** A share from 0 to 1 as a percentage, to one decimal: the figure of a rate metric. */
export function percent(rate: number): number {
  return Math.round(rate * 1000) / 10;
}

export function formatPercent(figure: number): string {
  return `${String(figure)}%`;
}

/** `value` rounded to `places` decimals. */
export function round(value: number, places: number): number {
  return Math.round(value * 10 ** places) / 10 ** places;
}

/** A share from 0 to 1, as datasets store a rate: to three decimals. */
export function share(part: number, whole: number): number {
  return round(part / whole, 3);
}

/** Hours from `from` to `to`, unrounded. */
export function hoursBetween(from: Date, to: Date): number {
  return msToHours(to.getTime() - from.getTime());
}

export function msToHours(ms: number): number {
  return ms / 3_600_000;
}

/** `1 ticket`, `2 tickets`; `many` for an irregular plural (`batches`). */
export function plural(count: number, word: string, many = `${word}s`): string {
  return `${String(count)} ${count === 1 ? word : many}`;
}

/** A metric's coverage as the report words it: `3 of 5 tickets`. */
export function coverageText({ tickets, of }: { tickets: number; of: number }): string {
  return `${String(tickets)} of ${String(of)} tickets`;
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
