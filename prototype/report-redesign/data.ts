// PROTOTYPE (throwaway). Reads the real datasets and approved case studies at
// build time and shapes them into what the variants render: per repo, each
// metric's headline figure, trend, comparison by autonomy level and per-ticket
// rows; across repos, the four pooled headline numbers.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUTONOMY_LEVELS, type AutonomyLevel } from "../../cli/autonomy.ts";
import { readApproved } from "../../cli/case-studies.ts";
import type { Dataset } from "../../cli/dataset.ts";
import { renderMarkdown } from "../../cli/markdown.ts";
import { escapeHtml } from "../../cli/metrics/html.ts";
import { METRICS } from "../../cli/metrics/index.ts";
import type { FigureResult, Metric, MetricResult } from "../../cli/metrics/metric.ts";
import { SUPPRESSED, UNKNOWN } from "../../cli/metrics/metric.ts";
import { coverageText, formatHours, percentile } from "../../cli/metrics/stats.ts";
import { cvSentences } from "../../cli/report-trends.ts";

export const LEVEL_NAMES: Record<AutonomyLevel, string> = { full: "Full autonomy", assisted: "Assisted", manual: "Manual" };
export { AUTONOMY_LEVELS };

/** Editorial grouping (variant C) and the order metrics are listed in. */
export const GROUPS = [
  { key: "speed", name: "Speed", metrics: ["leadTime", "throughput", "size", "estimateVsActual"] },
  { key: "quality", name: "Quality", metrics: ["firstRunCiRate", "regressionRate", "fixCycles", "batchHealth", "scheduledFailures", "testRatio", "netLinesRemoved"] },
  { key: "autonomy", name: "Autonomy", metrics: ["humanMessagesPerTicket", "autonomy", "subAgents", "orchestrationTime"] },
  { key: "cost", name: "Cost", metrics: ["apiEquivalentCost"] },
] as const;

export interface TicketRow { ticket: string; value: number; title: string; url: string; doneAt: string }

export interface MetricView {
  metric: Metric<unknown>;
  id: string;
  name: string;
  result: MetricResult<unknown>;
  known: boolean;
  /** The headline figure, plain text: `9.8 h`, `98.5%`, or `unknown`. */
  big: string;
  /** What the figure is, plus a second figure where there is one: `p50 · p90 2 d`. */
  label: string;
  coverage: string;
  /** The figure as a number, for the CV sentence lookups and bars. */
  figure: number | null;
  format: (n: number) => string;
  trend: { period: string; tickets: number; value: number | null; text: string; coverage: string }[];
  byLevel?: { level: AutonomyLevel; value: number | null; text: string; coverage: string; of: number }[];
  perTicket?: { rows: TicketRow[]; unit: string; edges?: number[]; edgeLabel?: (n: number) => string };
  sentence?: string;
  /** Section HTML from the metric itself: its own detail table, for metrics with no per-ticket rows here. */
  detailHtml?: string;
  page: string;
}

export interface Study { slug: string; ticket: string; title: string; criteria: string; numbers: { label: string; value: string }[]; html: string; page: string }

export interface RepoView {
  ds: Dataset;
  slug: string;
  name: string;
  url?: string;
  page: string;
  metrics: MetricView[];
  byId: Map<string, MetricView>;
  studies: Study[];
  sentences: { key: string; text: string }[];
  weeks: { week: string; tickets: number; pullRequests: number }[];
  autonomyCounts?: Record<AutonomyLevel, number>;
  firstMonth: string;
  lastMonth: string;
}

export interface Headline { id: string; name: string; big: string; small?: string; coverage: string; spark: { values: (number | null)[]; tips: string[] }; note: string; href: string }

export interface Report { repos: RepoView[]; headlines: Headline[]; generatedAt: string; totalTickets: number; totalPRs: number; months: string[] }

function figureText(metric: Metric<unknown>, r: FigureResult): { value: number | null; text: string } {
  if (typeof r.value === "number" && metric.figure) return { value: r.value, text: metric.figure.format(r.value) };
  return { value: null, text: r.value === SUPPRESSED ? "withheld" : "unknown" };
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const LEAD_EDGES = [0, 0.1, 1, 4, 12, 24, 48, 96, 192];

/** The per-ticket number each metric has, where it has one. */
function perTicketOf(id: string, value: unknown): { rows: { ticket: string; value: number }[]; unit: string; format: (n: number) => string; edges?: number[]; edgeLabel?: (n: number) => string } | undefined {
  const v = value as Record<string, unknown>;
  const arr = (key: string) => (Array.isArray(v[key]) ? (v[key] as Record<string, unknown>[]) : undefined);
  const pick = (key: string, field: string | ((row: Record<string, unknown>) => number | undefined)) =>
    arr(key)?.flatMap((row) => {
      const n = typeof field === "string" ? row[field] : field(row);
      return typeof n === "number" && Number.isFinite(n) ? [{ ticket: String(row.ticket), value: n }] : [];
    });
  switch (id) {
    case "leadTime": {
      const rows = pick("tickets", "hours");
      return rows && { rows, unit: "lead time", format: formatHours, edges: LEAD_EDGES, edgeLabel: (n) => (n === 0 ? "0" : n < 1 ? `${String(Math.round(n * 60))} m` : formatHours(n)) };
    }
    case "humanMessagesPerTicket": {
      const rows = pick("perTicket", "messages");
      return rows && { rows, unit: "human messages", format: String };
    }
    case "subAgents": {
      const rows = pick("perTicket", "subAgents");
      return rows && { rows, unit: "sub-agents", format: String };
    }
    case "apiEquivalentCost": {
      const rows = pick("perTicket", "apiEquivalentUsd");
      return rows && { rows, unit: "API-equivalent cost", format: usd };
    }
    case "size": {
      const rows = pick("tickets", "diffLines");
      return rows && { rows, unit: "diff lines", format: String };
    }
    case "testRatio": {
      const rows = pick("tickets", (row) => {
        const prod = row.productionLinesAdded as number, test = row.testLinesAdded as number;
        return prod > 0 ? Math.round((test / prod) * 100) / 100 : undefined;
      });
      return rows && { rows, unit: "test lines per production line", format: String };
    }
    case "netLinesRemoved": {
      const rows = pick("tickets", (row) => (row.linesDeleted as number) - (row.linesAdded as number));
      return rows && { rows, unit: "net lines removed", format: String };
    }
    default:
      return undefined;
  }
}

/** The headline figure and its label for a known value. */
function headlineOf(metric: Metric<unknown>, value: unknown): { big: string; label: string; figure: number | null } {
  const v = value as Record<string, number>;
  if (metric.id === "leadTime") return { big: formatHours(v.p50Hours ?? 0), label: `p50 · p90 ${formatHours(v.p90Hours ?? 0)}`, figure: v.p50Hours ?? null };
  if (metric.id === "humanMessagesPerTicket") return { big: String(v.p50), label: `p50 · p90 ${String(v.p90)}`, figure: v.p50 ?? null };
  if (metric.id === "subAgents") return { big: String(v.p50), label: `p50 per ticket · ${String(v.total)} in all`, figure: v.p50 ?? null };
  if (metric.id === "apiEquivalentCost") {
    const p = (value as { perTicketUsd?: { p50: number; p90: number }; apiEquivalentUsd: number }).perTicketUsd;
    const total = (value as { apiEquivalentUsd: number }).apiEquivalentUsd;
    return p ? { big: usd(p.p50), label: `p50 per ticket · ${usd(total)} in all`, figure: p.p50 } : { big: usd(total), label: "in all", figure: total };
  }
  if (metric.id === "autonomy") {
    const total = (v.full ?? 0) + (v.assisted ?? 0) + (v.manual ?? 0);
    return { big: `${String(v.full)} of ${String(total)}`, label: "tickets fully autonomous", figure: v.full ?? null };
  }
  if (metric.figure) {
    const n = metric.figure.of(value);
    if (Number.isFinite(n)) return { big: metric.figure.format(n), label: metric.figure.label, figure: n };
  }
  return { big: UNKNOWN, label: "", figure: null };
}

function fenced(markdown: string): string {
  // The shared renderer has no fenced code; keep ``` blocks as <pre> here.
  return markdown
    .split(/^```[^\n]*\n([\s\S]*?)^```\s*$/m)
    .map((part, i) => (i % 2 === 1 ? `<pre><code>${escapeHtml(part.replace(/\n$/, ""))}</code></pre>` : renderMarkdown(part)))
    .join("\n");
}

async function studiesOf(dir: string, slug: string): Promise<Study[]> {
  const approved = await readApproved(dir);
  return approved.map((study) => {
    const lines = study.markdown.split("\n");
    const title = (lines.find((l) => l.startsWith("# ")) ?? study.ticket).replace(/^# /, "");
    const criteria = (lines.find((l) => l.startsWith("Candidate for:")) ?? "").replace("Candidate for:", "").replace(/\.$/, "").trim();
    const numbers = lines.flatMap((l) => {
      const m = /^- (Size|Lead time|Human messages|Regressions): (.*)$/.exec(l);
      return m ? [{ label: m[1] ?? "", value: m[2] ?? "" }] : [];
    });
    // Drop the collector's boilerplate ("Draft written by … set approved: true …") and the H1 (the page has its own).
    const body = lines.filter((l) => !l.startsWith("Draft written by") && !l.startsWith("# ")).join("\n");
    const fileSlug = study.ticket.replace(/[^a-z0-9]+/gi, "").toLowerCase();
    return { slug: fileSlug, ticket: study.ticket, title, criteria, numbers, html: fenced(body), page: `${slug}--case-${fileSlug}.html` };
  });
}

function pooledPercentiles(values: number[]): { p50: number; p90: number } | undefined {
  return values.length ? { p50: percentile(values, 50), p90: percentile(values, 90) } : undefined;
}

export async function load(datasetsDir: string, caseStudiesDir: string, files: string[]): Promise<Report> {
  const datasets = files.map((f) => JSON.parse(readFileSync(join(datasetsDir, f), "utf8")) as Dataset);
  const repos: RepoView[] = [];
  for (const ds of datasets) {
    const slug = ds.repo.split("/").pop() ?? ds.repo;
    const titles = new Map((ds.ticketList ?? []).map((t) => [t.id, t]));
    const sentences = cvSentences(ds);
    const periods = ds.trends?.periods ?? [];
    const metrics = METRICS.flatMap((metric): MetricView[] => {
      const result = ds.metrics[metric.id];
      if (!result) return [];
      const known = result.value !== UNKNOWN;
      const h = known ? headlineOf(metric, result.value) : { big: UNKNOWN, label: metric.figure?.label ?? "", figure: null };
      const format = metric.figure?.format ?? String;
      const trendResults = ds.trends?.metrics[metric.id] ?? [];
      const trend = periods.map((p, i) => {
        const r = trendResults[i];
        const f = r ? figureText(metric, r) : { value: null, text: "unknown" };
        return { period: p.period, tickets: p.tickets, ...f, coverage: r ? coverageText(r.coverage) : "" };
      });
      const lv = ds.byAutonomy?.[metric.id];
      const byLevel =
        lv && metric.figure?.byAutonomy !== false
          ? AUTONOMY_LEVELS.map((level) => ({ level, ...figureText(metric, lv[level]), coverage: coverageText(lv[level].coverage), of: lv[level].coverage.of }))
          : undefined;
      const pt = known ? perTicketOf(metric.id, result.value) : undefined;
      const perTicket = pt && {
        unit: pt.unit,
        edges: pt.edges,
        edgeLabel: pt.edgeLabel,
        rows: pt.rows.map((r) => ({ ...r, title: titles.get(r.ticket)?.title ?? "", url: titles.get(r.ticket)?.url ?? "", doneAt: titles.get(r.ticket)?.doneAt.slice(0, 10) ?? "" })),
      };
      return [{
        metric,
        id: metric.id,
        name: metric.name,
        result,
        known,
        big: h.big,
        label: h.label,
        figure: h.figure,
        coverage: coverageText(result.coverage),
        format: metric.id === "apiEquivalentCost" ? usd : pt?.format ?? format,
        trend,
        byLevel,
        perTicket,
        sentence: sentences.find((s) => s.key === metric.id)?.text,
        detailHtml: !perTicket && known && metric.section ? metric.section(result.value) : undefined,
        page: `${slug}--${metric.id}.html`,
      }];
    });
    const throughput = ds.metrics.throughput?.value as { weeks?: RepoView["weeks"] } | undefined;
    const auto = ds.metrics.autonomy?.value;
    repos.push({
      ds,
      slug,
      name: ds.repo,
      url: ds.url,
      page: `${slug}.html`,
      metrics,
      byId: new Map(metrics.map((m) => [m.id, m])),
      studies: ds.publish === "full" ? await studiesOf(join(caseStudiesDir, ds.repo), slug) : [],
      sentences,
      weeks: throughput?.weeks ?? [],
      autonomyCounts: auto && auto !== UNKNOWN ? (auto as Record<AutonomyLevel, number>) : undefined,
      firstMonth: periods[0]?.period ?? "",
      lastMonth: periods.at(-1)?.period ?? "",
    });
  }
  // Main repo first: the one with the most tickets.
  repos.sort((a, b) => b.ds.tickets - a.ds.tickets);

  const months = [...new Set(repos.flatMap((r) => (r.ds.trends?.periods ?? []).map((p) => p.period)))].sort();
  return {
    repos,
    headlines: pooledHeadlines(repos, months),
    generatedAt: repos.map((r) => r.ds.generatedAt).sort().at(-1)?.slice(0, 10) ?? "",
    totalTickets: repos.reduce((n, r) => n + r.ds.tickets, 0),
    totalPRs: repos.reduce((n, r) => n + r.ds.pullRequests, 0),
    months,
  };
}

/** Each month's figure pooled over repos: from the per-ticket rows where there are some, else coverage-weighted. */
function pooledMonthly(repos: RepoView[], months: string[], id: string, fromRows?: (rows: { value: number }[]) => number): (number | null)[] {
  return months.map((month) => {
    if (fromRows) {
      const values = repos.flatMap((r) => (r.byId.get(id)?.perTicket?.rows ?? []).filter((row) => row.doneAt.startsWith(month)));
      return values.length ? fromRows(values) : null;
    }
    let sum = 0, weight = 0;
    for (const r of repos) {
      const t = r.byId.get(id)?.trend.find((p) => p.period === month);
      const i = r.ds.trends?.periods.findIndex((p) => p.period === month) ?? -1;
      const cov = i >= 0 ? r.ds.trends?.metrics[id]?.[i]?.coverage.tickets ?? 0 : 0;
      if (t?.value !== null && t?.value !== undefined && cov > 0) {
        sum += t.value * cov;
        weight += cov;
      }
    }
    return weight ? Math.round((sum / weight) * 10) / 10 : null;
  });
}

function monthShort(period: string): string {
  return new Date(`${period}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function pooledHeadlines(repos: RepoView[], months: string[]): Headline[] {
  const all = repos.reduce((n, r) => n + r.ds.tickets, 0);
  const cov = (id: string) => repos.reduce((n, r) => n + (r.byId.get(id)?.result.coverage.tickets ?? 0), 0);
  const rows = (id: string) => repos.flatMap((r) => r.byId.get(id)?.perTicket?.rows ?? []);
  const tips = (values: (number | null)[], f: (n: number) => string) => values.map((v, i) => `<b>${monthShort(months[i] ?? "")}</b><br>${v === null ? "unknown" : escapeHtml(f(v))}`);
  const p50 = (rs: { value: number }[]) => percentile(rs.map((r) => r.value), 50);

  const lead = pooledPercentiles(rows("leadTime").map((r) => r.value));
  const leadSpark = pooledMonthly(repos, months, "leadTime", p50);
  const human = pooledPercentiles(rows("humanMessagesPerTicket").map((r) => r.value));
  const humanSpark = pooledMonthly(repos, months, "humanMessagesPerTicket", p50);

  let passed = 0, prs = 0;
  let regressed = 0, regTickets = 0;
  for (const r of repos) {
    const ci = r.byId.get("firstRunCiRate");
    if (ci?.known) {
      const v = ci.result.value as { passed: number; pullRequests: number };
      passed += v.passed;
      prs += v.pullRequests;
    }
    const reg = r.byId.get("regressionRate");
    if (reg?.known) {
      regressed += (reg.result.value as { regressedTickets: number }).regressedTickets;
      regTickets += reg.result.coverage.tickets;
    }
  }
  const ciSpark = pooledMonthly(repos, months, "firstRunCiRate");
  const regSpark = pooledMonthly(repos, months, "regressionRate");
  const main = repos[0]?.slug ?? "";
  const pct = (n: number) => `${String(n)}%`;
  return [
    {
      id: "leadTime", name: "Lead time",
      big: lead ? formatHours(lead.p50) : UNKNOWN, small: lead ? `median · p90 ${formatHours(lead.p90)}` : undefined,
      coverage: coverageText({ tickets: cov("leadTime"), of: all }),
      spark: { values: leadSpark, tips: tips(leadSpark, formatHours) },
      note: "From a ticket being ready to its last PR merging",
      href: `${main}--leadTime.html`,
    },
    {
      id: "firstRunCiRate", name: "First-run CI",
      big: prs ? `${String(Math.round((passed / prs) * 1000) / 10)}%` : UNKNOWN, small: prs ? `of PRs · ${String(passed)} of ${String(prs)} green first time` : undefined,
      coverage: coverageText({ tickets: cov("firstRunCiRate"), of: all }),
      spark: { values: ciSpark, tips: tips(ciSpark, pct) },
      note: "Pull requests green on their first CI run",
      href: `${main}--firstRunCiRate.html`,
    },
    {
      id: "humanMessagesPerTicket", name: "Human messages",
      big: human ? String(human.p50) : UNKNOWN, small: human ? `per ticket, median · p90 ${String(human.p90)}` : undefined,
      coverage: coverageText({ tickets: cov("humanMessagesPerTicket"), of: all }),
      spark: { values: humanSpark, tips: tips(humanSpark, String) },
      note: "Messages I typed per delivered ticket",
      href: `${main}--humanMessagesPerTicket.html`,
    },
    {
      id: "regressionRate", name: "Regressions",
      big: regTickets ? `${String(Math.round((regressed / regTickets) * 1000) / 10)}%` : UNKNOWN, small: regTickets ? `of tickets · ${String(regressed)} of ${String(regTickets)} regressed` : undefined,
      coverage: coverageText({ tickets: cov("regressionRate"), of: all }),
      spark: { values: regSpark, tips: tips(regSpark, pct) },
      note: "Delivered tickets with a bug traced back to them",
      href: `${main}--regressionRate.html`,
    },
  ];
}

export { monthShort };
