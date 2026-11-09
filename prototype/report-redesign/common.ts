// PROTOTYPE (throwaway). Content blocks the variants may share: charts built
// from a metric's view, tables, small pieces of text. Layout stays in each variant.
import { escapeHtml } from "../../cli/metrics/html.ts";
import { formatHours, percentile } from "../../cli/metrics/stats.ts";
import { chart, type Column } from "./charts.ts";
import { AUTONOMY_LEVELS, GROUPS, LEVEL_NAMES, monthShort, type Headline, type MetricView, type Report, type RepoView } from "./data.ts";

export const e = escapeHtml;

export const UNKNOWN_TIP = "No source data for this: unknown, not zero.";

/** A value as text, or a quiet `unknown` that says it is not zero. */
export function val(text: string, cls = ""): string {
  return text === "unknown" ? `<span class="unknown ${cls}" title="${UNKNOWN_TIP}">unknown</span>` : `<span class="${cls}">${e(text)}</span>`;
}

export function cov(text: string): string {
  return `<span class="cov" title="Tickets this figure is computed over, out of all delivered">${e(text)}</span>`;
}

export function trendChart(m: MetricView, height = 180): string {
  if (m.trend.length === 0) return "";
  const points: Column[] = m.trend.map((t) => ({
    label: monthShort(t.period).replace(" 20", " ’"),
    sub: t.coverage.replace(" tickets", ""),
    value: t.value,
    text: t.text,
    tip: `<b>${e(monthShort(t.period))}</b><br>${t.value === null ? `${e(t.text)} <span class="muted">(not zero)</span>` : e(t.text)}<br><span class="muted">${e(t.coverage)}</span>`,
  }));
  return chart({ type: "columns", points, height }, `${m.name} by month`);
}

export function trendTable(m: MetricView): string {
  const rows = m.trend.map((t) => `<tr><td>${e(monthShort(t.period))}</td><td class="r">${val(t.text)}</td><td class="r cov">${e(t.coverage)}</td></tr>`).join("");
  return `<table class="data"><thead><tr><th>Month</th><th class="r">${e(m.name)}</th><th class="r">Coverage</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function autonomyChart(m: MetricView): string {
  if (!m.byLevel) return "";
  const rows = m.byLevel.map((l) => ({
    label: LEVEL_NAMES[l.level],
    cls: `l-${l.level}`,
    value: l.value,
    text: l.text,
    sub: l.coverage.replace(" tickets", ""),
    tip: `<b>${e(LEVEL_NAMES[l.level])}</b><br>${e(l.text)}${l.value === null ? " (not zero)" : ""}<br><span class="muted">${e(l.coverage)}</span>`,
  }));
  return chart({ type: "hbars", rows }, `${m.name} by autonomy level`);
}

/** Tickets per autonomy level, as bars. */
export function autonomyMix(repo: RepoView): string {
  const c = repo.autonomyCounts;
  if (!c) return `<p>${val("unknown")}</p>`;
  const total = c.full + c.assisted + c.manual;
  const rows = AUTONOMY_LEVELS.map((level) => ({
    label: LEVEL_NAMES[level],
    cls: `l-${level}`,
    value: c[level],
    text: `${String(c[level])} ticket${c[level] === 1 ? "" : "s"}`,
    sub: `${String(Math.round((c[level] / total) * 1000) / 10)}%`,
    tip: `<b>${e(LEVEL_NAMES[level])}</b><br>${String(c[level])} of ${String(total)} tickets`,
  }));
  return chart({ type: "hbars", rows }, "Tickets by autonomy level");
}

export function weeklyChart(repo: RepoView, height = 160): string {
  if (!repo.weeks.length) return "";
  const points: Column[] = repo.weeks.map((w) => ({
    label: new Date(`${w.week}T00:00:00Z`).toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    value: w.tickets,
    text: String(w.tickets),
    tip: `<b>Week of ${e(w.week)}</b><br>${String(w.tickets)} tickets in ${String(w.pullRequests)} PRs`,
  }));
  return chart({ type: "columns", points, height, valueLabels: "max" }, "Tickets delivered per week");
}

function bins(values: number[], edges?: number[]): number[] {
  if (edges) return edges;
  const sorted = [...values].sort((a, b) => a - b);
  const lo = Math.min(0, sorted[0] ?? 0);
  const hi = percentile(sorted, 95);
  const span = hi - lo || 1;
  const raw = span / 8;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let x = start; x <= hi; x += step) out.push(Math.round(x * 1000) / 1000);
  return out;
}

/** Per-ticket distribution: how many tickets fall in each range. */
export function distChart(m: MetricView, height = 200): string {
  const pt = m.perTicket;
  if (!pt || pt.rows.length === 0) return "";
  const values = pt.rows.map((r) => r.value);
  const edges = bins(values, pt.edges);
  const label = pt.edgeLabel ?? m.format;
  const points: Column[] = edges.map((lo, i) => {
    const hi = edges[i + 1];
    const count = values.filter((v) => v >= lo && (hi === undefined || v < hi)).length;
    const range = hi === undefined ? `≥ ${label(lo)}` : `${label(lo)}–${label(hi)}`;
    return {
      label: hi === undefined ? `${label(lo)}+` : label(lo),
      value: count,
      text: String(count),
      tip: `<b>${e(range)}</b><br>${String(count)} tickets`,
    };
  });
  return chart({ type: "columns", points, height, valueLabels: "all" }, `Distribution of ${pt.unit} per ticket`);
}

export function ticketTable(m: MetricView, limit?: number): string {
  const pt = m.perTicket;
  if (!pt) return m.detailHtml ? `<div class="scroll legacy">${m.detailHtml}</div>` : "";
  const rows = [...pt.rows].reverse().slice(0, limit ?? pt.rows.length);
  const body = rows
    .map((r) => {
      const t = r.url ? `<a href="${e(r.url)}">${e(r.ticket)}</a>` : e(r.ticket);
      return `<tr><td class="num">${t}</td><td>${e(r.title)}</td><td class="num muted" data-sort="${e(r.doneAt)}">${e(r.doneAt)}</td><td class="r" data-sort="${String(r.value)}">${e(m.format(r.value))}</td></tr>`;
    })
    .join("");
  return `<div class="tablewrap"><table class="data"><thead><tr><th>Ticket</th><th>Title</th><th>Delivered</th><th class="r">${e(pt.unit)}</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

export function definition(m: MetricView): string {
  return m.metric.methodology.definition;
}
export function limits(m: MetricView): string {
  return m.metric.methodology.limits;
}

/** The index's CV sentences: the pooled headlines in words, plus the clearest autonomy contrast of the main repo. */
export function indexSentences(report: Report): string[] {
  const h = (id: string) => report.headlines.find((x) => x.id === id) as Headline;
  const lead = h("leadTime"), ci = h("firstRunCiRate"), hm = h("humanMessagesPerTicket"), reg = h("regressionRate");
  const repos = `${String(report.repos.length)} repos`;
  const out: string[] = [];
  if (lead.big !== "unknown") out.push(`Delivered ${String(report.totalTickets)} tickets across ${repos} with a median lead time of ${lead.big} from ready to merged (${lead.small?.split("· ")[1] ?? ""}), over ${lead.coverage}.`);
  if (ci.big !== "unknown") out.push(`${ci.big} of pull requests passed CI on their first run (${ci.small?.split(" · ")[1]?.replace(" green first time", " PRs") ?? ""}), over ${ci.coverage}.`);
  if (hm.big !== "unknown") out.push(`A median of ${hm.big} human messages per ticket (${hm.small?.split("· ")[1] ?? ""}), over ${hm.coverage}.`);
  if (reg.big !== "unknown") out.push(`${reg.big} of delivered tickets had a regression traced back to them, over ${reg.coverage}.`);
  return out;
}

export function fmtHours(n: number): string {
  return formatHours(n);
}

/** The sentence of a metric with an autonomy comparison, from the repo's CV sentences. */
export function autonomySentence(repo: RepoView, id: string): string | undefined {
  return repo.sentences.find((s) => s.key === `${id}:autonomy`)?.text;
}
export function trendSentence(repo: RepoView, id: string): string | undefined {
  return repo.sentences.find((s) => s.key === `${id}:trend`)?.text;
}

/** Every page, for navigation. */
export function siteMap(report: Report): { repo: RepoView; metrics: MetricView[] }[] {
  return report.repos.map((repo) => ({ repo, metrics: repo.metrics }));
}

export function rawLink(repo: RepoView): string {
  return `https://grimfeld.github.io/agentic-metrics-report/datasets/${e(repo.name)}.json`;
}

/** Each metric some repo has, in group order, with each repo's view of it. */
export function methodEntries(report: Report, ids?: readonly string[]): { m: MetricView; per: { r: RepoView; m: MetricView }[] }[] {
  const all = ids ?? GROUPS.flatMap((g) => [...g.metrics]);
  return all.flatMap((id) => {
    const per = report.repos.flatMap((r) => {
      const m = r.byId.get(id);
      return m ? [{ r, m }] : [];
    });
    const first = per[0];
    return first ? [{ m: first.m, per }] : [];
  });
}
