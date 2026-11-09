// PROTOTYPE (throwaway). Variant A, "Executive one-pager": one narrow column,
// four huge numbers each with its sentence and sparkline, everything else one
// click away as a plain list.
import { sparkline } from "./charts.ts";
import { autonomyChart, autonomyMix, autonomySentence, cov, definition, distChart, e, indexSentences, limits, rawLink, ticketTable, trendChart, trendTable, val } from "./common.ts";
import { GROUPS, monthShort, type MetricView, type Report, type RepoView, type Study } from "./data.ts";

export const css = `
.va { max-width: 760px; margin: 0 auto; padding: 40px 16px 32px; }
.va header.top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 40px; font-size: 14px; color: var(--ink-2); }
.va header.top a { text-decoration: none; } .va header.top b { color: var(--ink); font-weight: 600; }
.va h1 { font-size: 32px; line-height: 1.15; margin: 0 0 8px; letter-spacing: -0.01em; }
.va .lede { font-size: 18px; color: var(--ink-2); margin: 0 0 40px; }
.va .bigs { display: grid; grid-template-columns: 1fr 1fr; gap: 40px 32px; margin: 0 0 48px; }
.va .big a { text-decoration: none; display: block; }
.va .big .n { font-size: clamp(44px, 9vw, 72px); font-weight: 700; line-height: 1; letter-spacing: -0.03em; }
.va .big .n small { font-size: 16px; font-weight: 500; letter-spacing: 0; color: var(--ink-2); margin-left: 6px; }
.va .big .k { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 8px; }
.va .big .s { margin: 8px 0 4px; color: var(--ink-2); font-size: 15px; }
.va .big .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.va h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; margin: 48px 0 12px; }
.va .words { margin: 0; padding: 0; list-style: none; }
.va .words li { font-size: 17px; padding: 10px 0; border-top: 1px solid var(--grid); }
.va .list { margin: 0; padding: 0; list-style: none; }
.va .list li { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--grid); align-items: baseline; flex-wrap: wrap; }
.va .list li a { font-weight: 500; }
.va .list .v { font-variant-numeric: tabular-nums; text-align: right; }
.va .more { display: inline-block; margin-top: 8px; font-size: 14px; }
.va .panel { background: var(--surface); border: 1px solid var(--ring); border-radius: 12px; padding: 16px; margin: 12px 0; }
.va .study-nums { display: flex; flex-wrap: wrap; gap: 8px 24px; font-size: 14px; color: var(--ink-2); margin: 0 0 24px; padding: 0; list-style: none; }
.va .study-nums b { color: var(--ink); font-weight: 600; display: block; font-size: 18px; }
.va footer { margin-top: 64px; font-size: 13px; color: var(--muted); }
@media (max-width: 560px) { .va .bigs { grid-template-columns: 1fr; gap: 32px; } .va { padding-top: 24px; } }
`;

function top(report: Report, crumbs: string): string {
  return `<header class="top"><a href="index.html"><b>Agentic metrics</b></a><span>${crumbs}</span><a href="methodology.html">How it’s measured</a></header>`;
}

function big(href: string, kicker: string, n: string, small: string | undefined, sentence: string, spark: string, coverage: string): string {
  return `<div class="big"><a href="${href}"><div class="k">${e(kicker)}</div><div class="n">${val(n)}${small ? `<small>${e(small)}</small>` : ""}</div></a><p class="s">${sentence}</p><div class="row">${spark}${cov(coverage)}</div></div>`;
}

export function index(report: Report): string {
  const bigs = report.headlines
    .map((h) => {
      const [first, second] = (h.small ?? "").split(" · ");
      return big(h.href, h.name, h.big, first, `${e(h.note)}${second ? `; ${e(second)}` : ""}.`, sparkline(h.spark.values, h.spark.tips), h.coverage);
    })
    .join("");
  const words = indexSentences(report).map((s) => `<li>${e(s)}</li>`).join("");
  const repos = report.repos
    .map((r) => {
      const lt = r.byId.get("leadTime");
      return `<li><a href="${r.page}">${e(r.name)}</a><span class="v">${String(r.ds.tickets)} tickets · ${lt ? `${val(lt.big)} median lead time` : ""}</span></li>`;
    })
    .join("");
  const studies = report.repos.flatMap((r) => r.studies.map((s) => ({ r, s })));
  return `<div class="va">${top(report, "")}
<h1>${String(report.totalTickets)} tickets shipped with Claude Code agents</h1>
<p class="lede">Measured from GitHub and Claude Code transcripts across ${String(report.repos.length)} repos, ${e(monthShort(report.months[0] ?? ""))} to ${e(monthShort(report.months.at(-1) ?? ""))}. Every number links to how it was computed.</p>
<div class="bigs">${bigs}</div>
<h2>In one line each</h2><ul class="words">${words}</ul>
<h2>Repos</h2><ul class="list">${repos}</ul>
${studies.length ? `<h2>Stories</h2><ul class="list">${studies.map(({ s }) => `<li><a href="${s.page}">${e(s.title)}</a><span class="v cov">${e(s.criteria)}</span></li>`).join("")}</ul>` : ""}
<footer>Collected ${e(report.generatedAt)}. Missing data is shown as <span class="unknown">unknown</span>, never as zero. <a href="methodology.html">Methodology and raw data</a>.</footer></div>`;
}

const REPO_BIGS = ["leadTime", "firstRunCiRate", "humanMessagesPerTicket", "regressionRate"];

function metricBig(repo: RepoView, m: MetricView): string {
  const tips = m.trend.map((t) => `<b>${e(monthShort(t.period))}</b><br>${e(t.text)}<br><span class="muted">${e(t.coverage)}</span>`);
  const [first, second] = m.label.split(" · ");
  return big(m.page, m.name, m.big, first, e(second ?? ""), sparkline(m.trend.map((t) => t.value), tips), m.coverage);
}

export function repo(report: Report, r: RepoView): string {
  const bigs = REPO_BIGS.flatMap((id) => {
    const m = r.byId.get(id);
    return m ? [metricBig(r, m)] : [];
  }).join("");
  const auto = r.byId.get("autonomy");
  const contrast = autonomySentence(r, "apiEquivalentCost") ?? autonomySentence(r, "humanMessagesPerTicket");
  const studies = r.studies.map((s) => `<li><a href="${s.page}">${e(s.title)}</a><span class="v cov">${e(s.criteria)}</span></li>`).join("");
  const all = GROUPS.flatMap((g) => g.metrics.flatMap((id) => (r.byId.get(id) ? [r.byId.get(id) as MetricView] : [])))
    .map((m) => `<li><a href="${m.page}">${e(m.name)}</a><span class="v">${val(m.big)} <span class="cov">· ${e(m.coverage)}</span></span></li>`)
    .join("");
  return `<div class="va">${top(report, e(r.name))}
<h1>${e(r.name)}</h1>
<p class="lede">${String(r.ds.tickets)} tickets in ${String(r.ds.pullRequests)} pull requests, ${e(monthShort(r.firstMonth))} to ${e(monthShort(r.lastMonth))}.${r.url ? ` <a href="${e(r.url)}">GitHub</a>.` : ""}</p>
<div class="bigs">${bigs}</div>
<h2>Autonomy</h2>
<p>${auto?.known ? `<b>${e(auto.big)}</b> ${e(auto.label)}.` : val("unknown")} ${contrast ? e(contrast) : ""}</p>
<div class="panel">${autonomyMix(r)}</div>
${studies ? `<h2>Stories</h2><ul class="list">${studies}</ul>` : ""}
<h2>Every metric</h2><ul class="list">${all}</ul>
<footer><a href="${rawLink(r)}">Raw dataset</a> · collected ${e(r.ds.generatedAt.slice(0, 10))}</footer></div>`;
}

export function metric(report: Report, r: RepoView, m: MetricView): string {
  const [first, second] = m.label.split(" · ");
  const dist = distChart(m);
  const auto = autonomyChart(m);
  return `<div class="va">${top(report, `<a href="${r.page}">${e(r.name)}</a>`)}
<div class="big"><div class="k">${e(m.name)}</div><div class="n">${val(m.big)}${first ? `<small>${e(first)}</small>` : ""}</div><p class="s">${e(second ?? "")}</p>${cov(m.coverage)}</div>
${m.sentence ? `<p class="lede" style="margin-top:24px">${e(m.sentence)}</p>` : ""}
${dist ? `<h2>Per ticket</h2><div class="panel">${dist}</div>` : ""}
<h2>By month</h2><div class="panel">${trendChart(m)}</div>
${auto ? `<h2>By autonomy level</h2><div class="panel">${auto}</div>` : ""}
<details><summary>All ${m.perTicket ? `${String(m.perTicket.rows.length)} tickets` : "details"} and the monthly table</summary>${ticketTable(m)}<div style="margin-top:16px">${trendTable(m)}</div></details>
<h2>How it’s measured</h2><p>${definition(m)}</p><p class="muted">${limits(m)}</p>
</div>`;
}

export function study(report: Report, r: RepoView, s: Study): string {
  return `<div class="va">${top(report, `<a href="${r.page}">${e(r.name)}</a>`)}
<div class="big"><div class="k">Story · ${e(s.criteria)}</div></div>
<h1>${e(s.title)}</h1>
<ul class="study-nums">${s.numbers.map((n) => `<li>${e(n.label)}<b>${val(n.value)}</b></li>`).join("")}</ul>
<article class="prose">${s.html}</article></div>`;
}

export function methodology(report: Report): string {
  const items = GROUPS.flatMap((g) => g.metrics)
    .map((id) => report.repos.flatMap((r) => (r.byId.get(id) ? [{ r, m: r.byId.get(id) as MetricView }] : [])))
    .filter((ms) => ms.length)
    .map((ms) => {
      const m = (ms[0] as { m: MetricView }).m;
      return `<li id="${m.id}" style="display:block"><b>${e(m.name)}</b><p>${definition(m)}</p><p class="muted">${limits(m)}</p><p class="cov">${ms.map((x) => `${e(x.r.slug)}: ${e(x.m.coverage)}${x.m.known ? "" : " (unknown)"}`).join(" · ")}</p></li>`;
    })
    .join("");
  return `<div class="va">${top(report, "Methodology")}
<h1>How it’s measured</h1>
<p class="lede">Every number comes from GitHub data and the local cache of Claude Code transcripts; only counts leave the machine. A metric whose source is missing is <span class="unknown">unknown</span>, never zero. Coverage is how many delivered tickets a number is computed over.</p>
<h2>Raw data</h2><ul class="list">${report.repos.map((r) => `<li><a href="${rawLink(r)}">${e(r.name)}.json</a><span class="v cov">${String(r.ds.tickets)} tickets</span></li>`).join("")}</ul>
<h2>Metrics</h2><ul class="list">${items}</ul></div>`;
}
