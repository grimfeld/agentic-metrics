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

/** A share from 0 to 1 as a percentage, to one decimal: the figure of a rate metric. */
export function percent(rate: number): number {
  return Math.round(rate * 1000) / 10;
}

export function formatPercent(figure: number): string {
  return `${String(figure)}%`;
}
