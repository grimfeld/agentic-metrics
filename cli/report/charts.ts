// Chart primitives: inline SVG drawn when the report is written, with no
// library and nothing loaded at view time. A metric's chart hook describes its
// chart as data (a `Chart`); `renderChart` draws it. Every chart is an `<svg
// role="img">` with a title and a description, and its numbers are also in a
// table beside it. A value that is unknown, or withheld from an anonymized
// dataset, is drawn as a gap labelled "unknown" or "—", never as a zero bar.
//
// Kinds: `line` (a figure over months), `columns` (counts over time),
// `distribution` (one dot per ticket, with markers such as p50 and p90) and
// `comparison` (horizontal bars, one row per autonomy level or per model).
// `sparkline` is the small trend line on a number tile.
//
// Charts are drawn in a 400-unit-wide viewBox that scales to their card.
// Colours come from the shell's tokens: `--series-1` to `--series-3`, ink and
// grid, so dark mode is the shell's.
import type { AutonomyLevel } from "../autonomy.ts";
import { AUTONOMY_LEVELS } from "../autonomy.ts";
import { escapeHtml } from "../metrics/html.ts";
import type { Figure, FigureResult } from "../metrics/metric.ts";
import { SUPPRESSED, UNKNOWN } from "../metrics/metric.ts";

export type ChartValue = number | typeof UNKNOWN | typeof SUPPRESSED;

/** One mark: a month, a week, a ticket, a level, a model. */
export interface Datum {
  label: string;
  /** A shorter label for the axis, such as `Oct 19` for the week of 2026-10-19; `label` when absent. */
  short?: string;
  value: ChartValue;
  /** The known value as text; `format(value)` when absent. */
  text?: string;
  /** Quiet detail shown beside the value and in the table, such as the coverage. */
  note?: string;
  /** Which series colour the mark wears (1 to 3); 1 when absent. */
  series?: 1 | 2 | 3;
}

interface ChartBase {
  data: Datum[];
  format: (value: number) => string;
  /** Plain text: what the chart shows, with its key numbers, for screen readers. */
  description: string;
  /** The table's headings: the label's, the value's, and the note's when data carry one. */
  heads: [string, string] | [string, string, string];
}

export type Chart =
  | (ChartBase & { kind: "line" })
  | (ChartBase & { kind: "columns" })
  | (ChartBase & { kind: "distribution"; markers: { label: string; value: number }[] })
  | (ChartBase & { kind: "comparison" });

/** What a metric's chart hook is given: its known value, its monthly trend and its figures by autonomy level. */
export interface ChartInput<V> {
  value: V;
  /** Its figure in each month with deliveries, oldest first. */
  trend: { period: string; result: FigureResult }[];
  /** Its figure at each autonomy level, when the dataset compares them. */
  byAutonomy?: Record<AutonomyLevel, FigureResult>;
}

const W = 400;
const LEVEL_NAMES: Record<AutonomyLevel, string> = { full: "Full", assisted: "Assisted", manual: "Manual" };
const LEVEL_SERIES: Record<AutonomyLevel, 1 | 2 | 3> = { full: 1, assisted: 2, manual: 3 };

/** `2026-10-19` as `Oct 19`. */
export function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** `2026-10` as `Oct 2026`. */
export function monthLabel(period: string): string {
  return new Date(`${period}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** A figure as a chart draws it: negated for one that reads the other way round (`Figure.drawNegated`). */
export function drawnValue(figure: Figure<unknown> | undefined, value: ChartValue): ChartValue {
  return figure?.drawNegated && typeof value === "number" ? -value : value;
}

/** How a chart formats a value it drew: the figure's own format, given the figure back. */
function drawnFormat(figure: Figure<unknown>): (value: number) => string {
  return (value) => figure.format(figure.drawNegated ? -value : value);
}

/** A figure's results as data: `unknown` and `suppressed` stay what they are, with the coverage as the note. */
function figureDatum(label: string, result: FigureResult, figure: Figure<unknown>, series?: 1 | 2 | 3): Datum {
  return {
    label,
    value: drawnValue(figure, result.value),
    ...(typeof result.value === "number" ? { text: figure.format(result.value) } : {}),
    note: `${String(result.coverage.tickets)} of ${String(result.coverage.of)}`,
    ...(series ? { series } : {}),
  };
}

/** A metric's figure by month, as a line: for a chart hook with nothing finer, and for metric pages. */
export function trendLine(input: ChartInput<unknown>, figure: Figure<unknown>, what: string): Chart {
  const format = drawnFormat(figure);
  const data = input.trend.map(({ period, result }) => figureDatum(monthLabel(period), result, figure));
  const known = data.filter((d) => typeof d.value === "number");
  const gaps = data.length - known.length;
  const first = known[0];
  const last = known.at(-1);
  const span = first && last && known.length > 1 ? ` It went from ${displayText(first, format)} in ${first.label} to ${displayText(last, format)} in ${last.label}.` : "";
  return {
    kind: "line",
    data,
    format,
    heads: ["Month", `${what} (${figure.label})`, "Tickets"],
    description: `${what} (${figure.label}) in each of ${String(data.length)} months with deliveries.${span}${gaps ? ` ${String(gaps)} unknown or withheld, drawn as gaps.` : ""}`,
  };
}

/** A metric's figure at each autonomy level, as comparison bars: for metric pages. */
export function autonomyComparison(input: ChartInput<unknown>, figure: Figure<unknown>, what: string): Chart | undefined {
  const levels = input.byAutonomy;
  if (!levels) return undefined;
  const format = drawnFormat(figure);
  const data = AUTONOMY_LEVELS.map((level) => figureDatum(LEVEL_NAMES[level], levels[level], figure, LEVEL_SERIES[level]));
  return {
    kind: "comparison",
    data,
    format,
    heads: ["Autonomy level", `${what} (${figure.label})`, "Tickets"],
    description: `${what} (${figure.label}) by autonomy level: ${data.map((d) => `${d.label} ${displayText(d, format)}`).join(", ")}.`,
  };
}

/** The tickets at each autonomy level, as comparison bars in the levels' colours. */
export function levelCounts(counts: Record<AutonomyLevel, number>): Datum[] {
  const total = AUTONOMY_LEVELS.reduce((sum, level) => sum + counts[level], 0);
  return AUTONOMY_LEVELS.map((level) => ({
    label: LEVEL_NAMES[level],
    value: counts[level],
    note: total ? `${String(Math.round((counts[level] / total) * 1000) / 10)}%` : "",
    series: LEVEL_SERIES[level],
  }));
}

function displayText(datum: Datum, format: (value: number) => string): string {
  if (datum.value === UNKNOWN) return "unknown";
  if (datum.value === SUPPRESSED) return "—";
  return datum.text ?? format(datum.value);
}

const n = (value: number) => String(Math.round(value * 10) / 10);

/** A clean round number at or above `max`. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= max) ?? 10;
  return step * power;
}

function text(x: number, y: number, cls: string, content: string, anchor = "start"): string {
  return `<text x="${n(x)}" y="${n(y)}" class="${cls}"${anchor === "start" ? "" : ` text-anchor="${anchor}"`}>${escapeHtml(content)}</text>`;
}

/** A transparent hover and focus target, larger than its mark, carrying its value. */
function hit(x: number, y: number, w: number, h: number, tip: string): string {
  return `<rect class="hit" x="${n(x)}" y="${n(y)}" width="${n(Math.max(w, 1))}" height="${n(Math.max(h, 1))}" tabindex="0" aria-label="${escapeHtml(tip)}" data-tip="${escapeHtml(tip)}"/>`;
}

function tipOf(datum: Datum, format: (value: number) => string): string {
  return `${datum.label}: ${displayText(datum, format)}${datum.note ? ` (${datum.note})` : ""}`;
}

/** A bar with a 4px round end at `to`, square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${n(x)},${n(y + h)}V${n(y + r)}Q${n(x)},${n(y)} ${n(x + r)},${n(y)}H${n(x + w - r)}Q${n(x + w)},${n(y)} ${n(x + w)},${n(y + r)}V${n(y + h)}Z`;
}

function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h / 2, w);
  return `M${n(x)},${n(y)}H${n(x + w - r)}Q${n(x + w)},${n(y)} ${n(x + w)},${n(y + r)}V${n(y + h - r)}Q${n(x + w)},${n(y + h)} ${n(x + w - r)},${n(y + h)}H${n(x)}Z`;
}

/** Every `every`-th x label, so that at most about six show. */
function labelEvery(count: number): number {
  return Math.max(1, Math.ceil(count / 6));
}

/** The value scale of a time chart: from 0 (or the lowest negative value) to a round maximum. */
function scale(values: number[], top: number, height: number) {
  const max = niceMax(Math.max(0, ...values));
  const min = Math.min(0, ...values) < 0 ? -niceMax(-Math.min(...values)) : 0;
  return { max, min, y: (value: number) => top + height - ((value - min) / (max - min)) * height };
}

function axes(top: number, height: number, s: ReturnType<typeof scale>, format: (value: number) => string): string {
  const ticks = s.min < 0 ? [s.min, 0, s.max] : [0, s.max / 2, s.max];
  return ticks
    .map((tick) => {
      const y = s.y(tick);
      return `<line class="${tick === 0 ? "base" : "grid"}" x1="0" x2="${String(W)}" y1="${n(y)}" y2="${n(y)}"/>${tick === 0 && s.min === 0 ? "" : text(0, y - 3, "t-muted", format(tick))}`;
    })
    .join("");
}

function line(chart: Chart): { body: string; height: number } {
  const H = 180;
  const top = 18;
  const bottom = 22;
  const plot = H - top - bottom;
  const known = chart.data.flatMap((d) => (typeof d.value === "number" ? [d.value] : []));
  const s = scale(known, top, plot);
  const band = W / chart.data.length;
  const x = (i: number) => band * i + band / 2;
  const every = labelEvery(chart.data.length);

  const segments: string[][] = [];
  let current: string[] = [];
  chart.data.forEach((d, i) => {
    if (typeof d.value !== "number") {
      if (current.length) segments.push(current);
      current = [];
    } else current.push(`${n(x(i))},${n(s.y(d.value))}`);
  });
  if (current.length) segments.push(current);
  const lines = segments.map((points) => (points.length > 1 ? `<polyline class="line" points="${points.join(" ")}"/>` : "")).join("");

  const lastKnown = chart.data.findLastIndex((d) => typeof d.value === "number");
  const marks = chart.data
    .map((d, i) => {
      const label = i % every === 0 ? text(x(i), H - 6, "t-ink2", d.short ?? d.label, "middle") : "";
      const target = hit(band * i, 0, band, H - bottom, tipOf(d, chart.format));
      if (typeof d.value !== "number") {
        return `${label}${text(x(i), top + plot - 6, "t-muted", displayText(d, chart.format), "middle")}${target}`;
      }
      const y = s.y(d.value);
      const alone = typeof chart.data[i - 1]?.value !== "number" && typeof chart.data[i + 1]?.value !== "number";
      const dot = i === lastKnown || alone ? `<circle class="dot" cx="${n(x(i))}" cy="${n(y)}" r="4"/>` : "";
      const value = i === lastKnown ? text(x(i), y - 8, "t-ink", displayText(d, chart.format), i === chart.data.length - 1 && chart.data.length > 1 ? "end" : "middle") : "";
      return `${label}${dot}${value}${target}`;
    })
    .join("");
  return { body: `${axes(top, plot, s, chart.format)}${lines}${marks}`, height: H };
}

function columns(chart: Chart): { body: string; height: number } {
  const H = 180;
  const top = 18;
  const bottom = 22;
  const plot = H - top - bottom;
  const known = chart.data.flatMap((d) => (typeof d.value === "number" ? [d.value] : []));
  const s = scale(known, top, plot);
  const band = W / chart.data.length;
  const width = Math.max(2, Math.min(24, band * 0.62));
  const every = labelEvery(chart.data.length);
  const highest = Math.max(...known);
  const peak = chart.data.findIndex((d) => d.value === highest);
  const marks = chart.data
    .map((d, i) => {
      const cx = band * i + band / 2;
      const label = i % every === 0 ? text(cx, H - 6, "t-ink2", d.short ?? d.label, "middle") : "";
      const target = hit(band * i, 0, band, H - bottom, tipOf(d, chart.format));
      if (typeof d.value !== "number") {
        const mark = chart.data.length <= 12 ? displayText(d, chart.format) : d.value === SUPPRESSED ? "—" : "?";
        return `${label}${text(cx, top + plot - 6, "t-muted", mark, "middle")}${target}`;
      }
      const zero = s.y(0);
      const y = s.y(d.value);
      const bar = d.value === 0 ? "" : d.value > 0 ? columnPath(cx - width / 2, y, width, zero - y) : `<rect class="bar s${String(d.series ?? 1)}" x="${n(cx - width / 2)}" y="${n(zero)}" width="${n(width)}" height="${n(y - zero)}"/>`;
      const path = bar && d.value > 0 ? `<path class="bar s${String(d.series ?? 1)}" d="${bar}"/>` : bar;
      const value = i === peak || chart.data.length <= 8 ? text(cx, Math.min(y, zero) - 5, "t-ink", displayText(d, chart.format), "middle") : "";
      return `${label}${path}${value}${target}`;
    })
    .join("");
  return { body: `${axes(top, plot, s, chart.format)}${marks}`, height: H };
}

function distribution(chart: Chart & { kind: "distribution" }): { body: string; height: number } {
  const values = chart.data.flatMap((d) => (typeof d.value === "number" ? [{ d, value: d.value }] : []));
  const max = niceMax(Math.max(0, ...values.map((v) => v.value), ...chart.markers.map((m) => m.value)));
  const x = (value: number) => 4 + (value / max) * (W - 8);
  // One dot per ticket, stacked where they would overlap, shrinking until the
  // tallest stack fits; too many for that, and the tickets are counted in bins.
  const PLOT = 96;
  const stackOf = (radius: number) => {
    const counts = new Map<number, number>();
    const at = values.map(({ value }) => {
      const bin = Math.round(x(value) / (radius * 2 + 1));
      const k = counts.get(bin) ?? 0;
      counts.set(bin, k + 1);
      return k;
    });
    return { at, tallest: Math.max(1, ...counts.values()) };
  };
  let r = 4;
  let placed = stackOf(r);
  while (r > 2.5 && placed.tallest * (r * 2 + 1) > PLOT) {
    r -= 0.5;
    placed = stackOf(r);
  }
  const dense = placed.tallest * (r * 2 + 1) > PLOT;
  // Marker labels take two rows, so that p50 and p90 never overlap.
  const top = 40;
  const plot = dense ? PLOT : placed.tallest * (r * 2 + 1);
  const base = top + plot + 4;
  const H = base + 22;
  let dots: string;
  if (dense) {
    const bins = 40;
    const step = max / bins;
    const counts = Array.from({ length: bins }, () => 0);
    for (const { value } of values) {
      const bin = Math.min(bins - 1, Math.floor(value / step));
      counts[bin] = (counts[bin] ?? 0) + 1;
    }
    const most = Math.max(...counts);
    const band = (W - 8) / bins;
    dots = counts
      .map((count, i) => {
        const tip = `${chart.format(i * step)} to ${chart.format((i + 1) * step)}: ${String(count)} ${count === 1 ? "ticket" : "tickets"}`;
        const h = count ? Math.max(2, (count / most) * plot) : 0;
        const bar = h ? `<path class="bar s1" d="${columnPath(4 + band * i + 1, base - h, band - 2, h)}"/>` : "";
        return `${bar}${hit(4 + band * i, top, band, plot + 4, tip)}`;
      })
      .join("");
  } else {
    dots = values
      .map(({ d, value }, i) => {
        const cy = base - r - 2 - (placed.at[i] ?? 0) * (r * 2 + 1);
        const tip = tipOf(d, chart.format);
        return `<circle class="dot s${String(d.series ?? 1)}" cx="${n(Math.round(x(value) / (r * 2 + 1)) * (r * 2 + 1))}" cy="${n(cy)}" r="${n(r)}"/>${hit(x(value) - 6, cy - 6, 12, 12, tip)}`;
      })
      .join("");
  }
  const markers = chart.markers
    .map((m, i) => {
      const mx = x(m.value);
      const anchor = mx > W - 60 ? "end" : mx < 60 ? "start" : "middle";
      return `<line class="marker" x1="${n(mx)}" x2="${n(mx)}" y1="${n(top - 18 + (i % 2) * 12)}" y2="${n(base)}"/>${text(mx, top - 22 + (i % 2) * 12, "t-ink", `${m.label} ${chart.format(m.value)}`, anchor)}`;
    })
    .join("");
  const ticks = [0, max / 2, max].map((tick, i) => text(x(tick), H - 6, "t-muted", chart.format(tick), i === 0 ? "start" : i === 2 ? "end" : "middle")).join("");
  return { body: `<line class="base" x1="0" x2="${String(W)}" y1="${n(base)}" y2="${n(base)}"/>${markers}${dots}${ticks}`, height: H };
}

function comparison(chart: Chart): { body: string; height: number } {
  const row = 40;
  const room = 130;
  const plot = W - room;
  const known = chart.data.flatMap((d) => (typeof d.value === "number" ? [d.value] : []));
  const max = Math.max(0, ...known) || 1;
  const body = chart.data
    .map((d, i) => {
      const y = i * row;
      const label = text(0, y + 12, "t-ink2", d.label);
      const by = y + 17;
      const target = hit(0, y, W, row, tipOf(d, chart.format));
      const note = d.note ? `<tspan class="t-muted" dx="6">${escapeHtml(d.note)}</tspan>` : "";
      if (typeof d.value !== "number") {
        return `${label}<line class="base" x1="0.5" x2="0.5" y1="${n(by - 2)}" y2="${n(by + 18)}"/><text x="6" y="${n(by + 13)}" class="t-muted">${escapeHtml(displayText(d, chart.format))}${note}</text>${target}`;
      }
      const w = d.value > 0 ? Math.max(2, (d.value / max) * plot) : 0;
      const bar = w ? `<path class="bar s${String(d.series ?? 1)}" d="${barPath(0, by, w, 16)}"/>` : "";
      return `${label}<line class="base" x1="0.5" x2="0.5" y1="${n(by - 2)}" y2="${n(by + 18)}"/>${bar}<text x="${n(w + 6)}" y="${n(by + 13)}" class="t-ink">${escapeHtml(displayText(d, chart.format))}${note}</text>${target}`;
    })
    .join("");
  return { body, height: chart.data.length * row };
}

function table(chart: Chart): string {
  const withNote = chart.heads.length === 3;
  const head = chart.heads.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const rows = chart.data
    .map((d) => `<tr><td>${escapeHtml(d.label)}</td><td>${escapeHtml(displayText(d, chart.format))}</td>${withNote ? `<td>${escapeHtml(d.note ?? "")}</td>` : ""}</tr>`)
    .join("");
  return `<details class="numbers"><summary>Numbers</summary><div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

/**
 * A chart as an accessible inline SVG, followed by its numbers as a table.
 * `id` must be unique on the page: it names the title and description.
 */
export function renderChart(chart: Chart, { id, title }: { id: string; title: string }): string {
  if (chart.data.length === 0) return `<p class="unknown">No data to chart</p>`;
  const { body, height } =
    chart.kind === "line" ? line(chart) : chart.kind === "columns" ? columns(chart) : chart.kind === "distribution" ? distribution(chart) : comparison(chart);
  const svg = `<svg class="chart" viewBox="0 0 ${String(W)} ${n(height)}" role="img" aria-labelledby="${id}-title ${id}-desc"><title id="${id}-title">${escapeHtml(title)}</title><desc id="${id}-desc">${escapeHtml(chart.description)}</desc>${body}</svg>`;
  return `${svg}\n${table(chart)}`;
}

/** A small trend line for a number tile: gaps where a month is unknown or withheld, a dot on the last known month. Decorative: the tile states the number. */
export function sparkline(values: readonly ChartValue[]): string {
  const known = values.flatMap((value) => (typeof value === "number" ? [value] : []));
  if (known.length === 0) return "";
  const w = 80;
  const h = 24;
  const pad = 4;
  const max = Math.max(...known);
  const min = Math.min(0, ...known);
  const x = (i: number) => (values.length === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (values.length - 1));
  const y = (v: number) => (max === min ? h / 2 : h - pad - ((v - min) / (max - min)) * (h - 2 * pad));
  const segments: string[][] = [];
  let current: string[] = [];
  values.forEach((value, i) => {
    if (typeof value !== "number") {
      if (current.length) segments.push(current);
      current = [];
    } else current.push(`${n(x(i))},${n(y(value))}`);
  });
  if (current.length) segments.push(current);
  const lines = segments.map((points) => (points.length > 1 ? `<polyline class="line" points="${points.join(" ")}"/>` : "")).join("");
  const last = values.findLastIndex((value) => typeof value === "number");
  const lastValue = values[last];
  const dot = typeof lastValue === "number" ? `<circle class="dot" cx="${n(x(last))}" cy="${n(y(lastValue))}" r="2.5"/>` : "";
  return `<svg class="spark" viewBox="0 0 ${String(w)} ${String(h)}" aria-hidden="true" focusable="false">${lines}${dot}</svg>`;
}


/** Chart styles, shared by every page that draws one. */
export const CHART_CSS = `
svg.chart { display: block; width: 100%; height: auto; overflow: visible; font: 11px var(--font); }
svg.chart text { fill: var(--muted); }
svg.chart .t-ink { fill: var(--ink); font-weight: 600; }
svg.chart .t-ink2 { fill: var(--ink-2); }
svg.chart .t-muted { fill: var(--muted); }
svg.chart .grid { stroke: var(--grid); stroke-width: 1; }
svg.chart .base { stroke: var(--axis); stroke-width: 1; }
svg.chart .marker { stroke: var(--ink-2); stroke-width: 1; }
svg.chart .line, svg.spark .line { fill: none; stroke: var(--series-1); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
svg.spark .line { stroke-width: 1.5; }
svg.chart .dot, svg.spark .dot { fill: var(--series-1); stroke: var(--surface); stroke-width: 2; }
svg.chart .bar, svg.chart .s1 { fill: var(--series-1); }
svg.chart .s2 { fill: var(--series-2); }
svg.chart .s3 { fill: var(--series-3); }
svg.chart .hit { fill: transparent; outline: none; }
svg.chart .hit:hover, svg.chart .hit:focus-visible { fill: var(--wash); }
svg.spark { display: block; width: 80px; height: 24px; flex: none; }
.numbers { margin-top: 6px; font-size: 13px; }
.numbers summary { cursor: pointer; color: var(--muted); }
.numbers table { margin-top: 6px; }
@media (max-width: 760px) { svg.chart { font-size: 13px; } }
.chart-tip { position: fixed; z-index: 10; pointer-events: none; background: var(--surface); color: var(--ink); border: 1px solid var(--ring); border-radius: 6px; padding: 4px 8px; font-size: 12px; box-shadow: 0 2px 8px var(--ring); }
`;

/** Shows a mark's value beside the pointer, or beside a mark focused by keyboard. Inline: the report loads nothing from the network. */
export const CHART_SCRIPT = `(function () {
  var tip = null;
  function show(target, x, y) {
    if (!tip) { tip = document.createElement("div"); tip.className = "chart-tip"; document.body.appendChild(tip); }
    tip.textContent = target.getAttribute("data-tip");
    tip.hidden = false;
    tip.style.left = Math.min(x + 12, window.innerWidth - tip.offsetWidth - 8) + "px";
    tip.style.top = (y + 12) + "px";
  }
  function hide() { if (tip) tip.hidden = true; }
  function mark(event) { return event.target instanceof Element ? event.target.closest("[data-tip]") : null; }
  document.addEventListener("pointermove", function (event) { var m = mark(event); if (m) show(m, event.clientX, event.clientY); else hide(); });
  document.addEventListener("focusin", function (event) { var m = mark(event); if (!m) return hide(); var r = m.getBoundingClientRect(); show(m, r.left, r.top); });
  document.addEventListener("focusout", hide);
})();`;
