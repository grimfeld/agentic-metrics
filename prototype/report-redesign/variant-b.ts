// PROTOTYPE (throwaway). Variant B, "Dashboard": app shell with a sidebar of
// every page, dense KPI tiles, and a grid of chart cards.
import { sparkline } from "./charts.ts";
import { autonomyChart, autonomyMix, cov, definition, distChart, e, indexSentences, limits, methodEntries, rawLink, ticketTable, trendChart, trendTable, val, weeklyChart } from "./common.ts";
import { GROUPS, LEVEL_NAMES, monthShort, type MetricView, type Report, type RepoView, type Study } from "./data.ts";

export const css = `
.vb { display: grid; grid-template-columns: 232px 1fr; min-height: 100vh; }
.vb nav.side { position: sticky; top: 0; height: 100vh; overflow-y: auto; background: var(--surface); border-right: 1px solid var(--grid); padding: 16px 10px 96px; font-size: 13px; }
.vb nav.side .brand { font-weight: 700; font-size: 14px; padding: 4px 8px 14px; display: block; text-decoration: none; }
.vb nav.side .grp { color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-size: 11px; font-weight: 600; padding: 14px 8px 4px; }
.vb nav.side a { display: flex; justify-content: space-between; gap: 8px; padding: 4px 8px; border-radius: 6px; text-decoration: none; color: var(--ink-2); }
.vb nav.side a:hover { background: var(--plane); color: var(--ink); }
.vb nav.side a.on { background: var(--wash); color: var(--ink); font-weight: 600; }
.vb nav.side a .v { color: var(--muted); font-variant-numeric: tabular-nums; font-weight: 400; }
.vb nav.side .sub a { padding-left: 18px; }
.vb main { padding: 20px 24px 40px; min-width: 0; }
.vb .bar { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 16px; margin-bottom: 16px; }
.vb .bar h1 { font-size: 20px; margin: 0; }
.vb .chips { display: flex; flex-wrap: wrap; gap: 6px; }
.vb .chip { font-size: 12px; color: var(--ink-2); background: var(--surface); border: 1px solid var(--ring); border-radius: 999px; padding: 2px 10px; text-decoration: none; }
.vb .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin-bottom: 12px; }
.vb .kpi { background: var(--surface); border: 1px solid var(--ring); border-radius: 10px; padding: 10px 12px; text-decoration: none; display: block; min-width: 0; }
.vb a.kpi:hover { border-color: var(--axis); }
.vb .kpi .k { font-size: 12px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vb .kpi .n { font-size: 24px; font-weight: 650; line-height: 1.2; margin: 2px 0; font-variant-numeric: tabular-nums; }
.vb .kpi .n small { font-size: 12px; color: var(--muted); font-weight: 400; margin-left: 4px; }
.vb .kpi .f { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.vb .kpi .spark { width: 80px; height: 24px; }
.vb .kpi.lg .n { font-size: 30px; }
.vb .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.vb .card { background: var(--surface); border: 1px solid var(--ring); border-radius: 10px; padding: 12px 14px; min-width: 0; }
.vb .card.wide { grid-column: 1 / -1; }
.vb .card h2 { font-size: 13px; font-weight: 600; margin: 0 0 2px; }
.vb .card .h { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; margin-bottom: 6px; flex-wrap: wrap; }
.vb .card p { font-size: 13px; color: var(--ink-2); margin: 0 0 8px; }
.vb .sent { list-style: none; margin: 0; padding: 0; font-size: 13px; }
.vb .sent li { padding: 6px 0; border-top: 1px solid var(--grid); }
.vb .sent li:first-child { border-top: 0; }
.vb table.data { font-size: 13px; }
.vb .tablewrap { max-height: 420px; }
.vb .stud { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.vb .stud a { display: block; text-decoration: none; background: var(--plane); border-radius: 8px; padding: 8px 10px; font-size: 13px; }
.vb .stud a b { display: block; font-weight: 600; margin-bottom: 2px; }
@media (max-width: 860px) {
  .vb { grid-template-columns: 1fr; }
  .vb nav.side { position: static; height: auto; display: flex; overflow-x: auto; gap: 4px; padding: 8px; border-right: 0; border-bottom: 1px solid var(--grid); white-space: nowrap; }
  .vb nav.side .grp, .vb nav.side .sub { display: none; }
  .vb nav.side .brand { padding: 4px 8px; }
  .vb main { padding: 16px; }
  .vb .grid { grid-template-columns: 1fr; }
  .vb .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
`;

function side(report: Report, current: string): string {
  const a = (href: string, label: string, v = "") => `<a href="${href}"${href === current ? ' class="on"' : ""}>${label}${v ? `<span class="v">${v}</span>` : ""}</a>`;
  const repos = report.repos
    .map((r) => {
      const open = current.startsWith(`${r.slug}.`) || current.startsWith(`${r.slug}--`);
      const metrics = open
        ? `<div class="sub">${GROUPS.flatMap((g) => g.metrics.flatMap((id) => (r.byId.get(id) ? [r.byId.get(id) as MetricView] : []))).map((m) => a(m.page, e(m.name), m.known ? e(m.big) : "—")).join("")}${r.studies.map((s) => a(s.page, `Story ${e(s.ticket)}`)).join("")}</div>`
        : "";
      return a(r.page, e(r.slug), String(r.ds.tickets)) + metrics;
    })
    .join("");
  return `<nav class="side"><a class="brand" href="index.html">Agentic metrics</a>${a("index.html", "Overview")}<div class="grp">Repos</div>${repos}<div class="grp">Reference</div>${a("methodology.html", "Methodology")}</nav>`;
}

function shell(report: Report, current: string, title: string, chips: string, body: string): string {
  return `<div class="vb">${side(report, current)}<main><div class="bar"><h1>${title}</h1><div class="chips">${chips}</div></div>${body}</main></div>`;
}

function kpi(href: string | undefined, name: string, big: string, small: string, coverage: string, spark = "", lg = false): string {
  const inner = `<div class="k" title="${e(name)}">${e(name)}</div><div class="n">${val(big)}${small ? `<small>${e(small)}</small>` : ""}</div><div class="f">${cov(coverage)}${spark}</div>`;
  return href ? `<a class="kpi${lg ? " lg" : ""}" href="${href}">${inner}</a>` : `<div class="kpi${lg ? " lg" : ""}">${inner}</div>`;
}

function metricKpi(m: MetricView): string {
  const tips = m.trend.map((t) => `<b>${e(monthShort(t.period))}</b><br>${e(t.text)}`);
  return kpi(m.page, m.name, m.big, m.label.split(" · ")[0] ?? "", m.coverage.replace(" tickets", ""), sparkline(m.trend.map((t) => t.value), tips));
}

function card(title: string, right: string, body: string, wide = false): string {
  return `<section class="card${wide ? " wide" : ""}"><div class="h"><h2>${title}</h2>${right}</div>${body}</section>`;
}

export function index(report: Report): string {
  const kpis = report.headlines.map((h) => kpi(h.href, h.name, h.big, (h.small ?? "").split(" · ")[0] ?? "", `${(h.small ?? "").split(" · ")[1] ?? ""} · ${h.coverage.replace(" tickets", "")}`, sparkline(h.spark.values, h.spark.tips), true)).join("");
  const cols = ["leadTime", "firstRunCiRate", "humanMessagesPerTicket", "regressionRate", "apiEquivalentCost", "autonomy"];
  const head = cols.map((id) => `<th class="r">${e(report.repos[0]?.byId.get(id)?.name ?? id)}</th>`).join("");
  const rows = report.repos
    .map((r) => `<tr><td><a href="${r.page}">${e(r.slug)}</a></td><td class="r">${String(r.ds.tickets)}</td>${cols.map((id) => { const m = r.byId.get(id); return `<td class="r">${m ? `${val(m.big)}<br><span class="cov">${e(m.coverage.replace(" tickets", ""))}</span>` : "—"}</td>`; }).join("")}</tr>`)
    .join("");
  const main = report.repos[0];
  const studies = report.repos.flatMap((r) => r.studies.map((s) => `<a href="${s.page}"><b>${e(s.title)}</b><span class="muted">${e(r.slug)} · ${e(s.criteria)}</span></a>`)).join("");
  const body = `<div class="kpis">${kpis}</div>
<div class="grid">
${card("Repos", "", `<div class="scroll"><table class="data"><thead><tr><th>Repo</th><th class="r">Tickets</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`, true)}
${main ? card(`Tickets per week <span class="muted">· ${e(main.slug)}</span>`, `<a class="chip" href="${main.byId.get("throughput")?.page ?? main.page}">Throughput</a>`, weeklyChart(main)) : ""}
${main ? card(`Autonomy mix <span class="muted">· ${e(main.slug)}</span>`, `<a class="chip" href="${main.byId.get("autonomy")?.page ?? main.page}">Autonomy</a>`, autonomyMix(main)) : ""}
${card("CV-ready sentences", "", `<ul class="sent">${indexSentences(report).map((s) => `<li>${e(s)}</li>`).join("")}</ul>`)}
${studies ? card("Case studies", "", `<div class="stud">${studies}</div>`) : ""}
</div>`;
  return shell(report, "index.html", "Overview", `<span class="chip">${String(report.totalTickets)} tickets</span><span class="chip">${String(report.repos.length)} repos</span><span class="chip">collected ${e(report.generatedAt)}</span>`, body);
}

export function repo(report: Report, r: RepoView): string {
  const kpis = GROUPS.flatMap((g) => g.metrics.flatMap((id) => (r.byId.get(id) ? [metricKpi(r.byId.get(id) as MetricView)] : []))).join("");
  const lead = r.byId.get("leadTime");
  const cost = r.byId.get("apiEquivalentCost");
  const hm = r.byId.get("humanMessagesPerTicket");
  const studies = r.studies.map((s) => `<a href="${s.page}"><b>${e(s.title)}</b><span class="muted">${e(s.criteria)}</span></a>`).join("");
  const body = `<div class="kpis">${kpis}</div>
<div class="grid">
${card("Tickets per week", "", weeklyChart(r))}
${card("Autonomy mix", "", autonomyMix(r))}
${lead ? card("Lead time per ticket", `<a class="chip" href="${lead.page}">${e(lead.big)} p50</a>`, distChart(lead)) : ""}
${lead ? card("Lead time p50 by month", "", trendChart(lead)) : ""}
${hm ? card("Human messages by autonomy level", `<a class="chip" href="${hm.page}">open</a>`, autonomyChart(hm)) : ""}
${cost ? card("Cost per ticket by autonomy level", `<a class="chip" href="${cost.page}">open</a>`, autonomyChart(cost)) : ""}
${studies ? card("Case studies", "", `<div class="stud">${studies}</div>`, true) : ""}
</div>`;
  return shell(report, r.page, e(r.name), `<span class="chip">${String(r.ds.tickets)} tickets</span><span class="chip">${String(r.ds.pullRequests)} PRs</span><span class="chip">${e(monthShort(r.firstMonth))} – ${e(monthShort(r.lastMonth))}</span>${r.url ? `<a class="chip" href="${e(r.url)}">GitHub</a>` : ""}<a class="chip" href="${rawLink(r)}">raw JSON</a>`, body);
}

export function metric(report: Report, r: RepoView, m: MetricView): string {
  const parts = m.label.split(" · ");
  const known = m.trend.filter((t) => t.value !== null).length;
  const kpis = [
    kpi(undefined, m.name, m.big, parts[0] ?? "", m.coverage),
    parts[1] ? kpi(undefined, parts[1].startsWith("p90") ? "90th percentile" : "Also", parts[1].replace(/^p90 /, ""), "", m.coverage) : "",
    kpi(undefined, "Months known", `${String(known)} of ${String(m.trend.length)}`, "", "unknown months are not zero"),
    m.byLevel ? kpi(undefined, LEVEL_NAMES.full, m.byLevel[0]?.text ?? "unknown", "", m.byLevel[0]?.coverage ?? "") : "",
  ].join("");
  const dist = distChart(m);
  const auto = autonomyChart(m);
  const body = `<div class="kpis">${kpis}</div>
<div class="grid">
${dist ? card("Per ticket", `<span class="cov">${e(m.perTicket?.unit ?? "")}</span>`, dist) : ""}
${card("By month", "", trendChart(m))}
${auto ? card("By autonomy level", "", auto) : ""}
${card("Definition", "", `<p>${definition(m)}</p><p class="muted">${limits(m)}</p>`)}
${card(m.perTicket ? `All ${String(m.perTicket.rows.length)} tickets` : "Detail", `<span class="cov">click a column to sort</span>`, ticketTable(m), true)}
${card("Monthly table", "", trendTable(m), true)}
</div>`;
  return shell(report, m.page, `${e(m.name)} <span class="muted" style="font-weight:400">· ${e(r.slug)}</span>`, m.sentence ? `<span class="chip" title="${e(m.sentence)}">${e(m.sentence.length > 90 ? `${m.sentence.slice(0, 88)}…` : m.sentence)}</span>` : "", body);
}

export function study(report: Report, r: RepoView, s: Study): string {
  const kpis = s.numbers.map((n) => kpi(undefined, n.label, n.value.replace(/ \(.*$/, ""), "", n.value.includes("(") ? n.value.replace(/^[^(]*\(|\)$/g, "") : "")).join("");
  const body = `<div class="kpis">${kpis}</div><div class="grid">${card(e(s.title), `<span class="chip">${e(s.criteria)}</span>`, `<article class="prose">${s.html}</article>`, true)}</div>`;
  return shell(report, s.page, `Case study ${e(s.ticket)} <span class="muted" style="font-weight:400">· ${e(r.slug)}</span>`, "", body);
}

export function methodology(report: Report): string {
  const rows = methodEntries(report)
    .map(({ m, per }) => `<tr id="${m.id}"><td><b>${e(m.name)}</b></td><td>${definition(m)}<br><span class="muted">${limits(m)}</span></td>${per.map((p) => `<td class="r">${val(p.m.known ? p.m.big : "unknown")}<br><span class="cov">${e(p.m.coverage.replace(" tickets", ""))}</span></td>`).join("")}</tr>`)
    .join("");
  const body = `<div class="grid">
${card("Principles", "", `<p>Every number is derived from GitHub data and the local cache of Claude Code transcripts, of which only counts reach the dataset. A metric whose source is missing is <span class="unknown">unknown</span>, never zero. Coverage = tickets a metric is computed over, of tickets delivered.</p>`)}
${card("Raw data", "", `<ul class="sent">${report.repos.map((r) => `<li><a href="${rawLink(r)}">${e(r.name)}.json</a> <span class="cov">${String(r.ds.tickets)} tickets · ${e(r.ds.generatedAt.slice(0, 10))}</span></li>`).join("")}</ul>`)}
${card("Metrics", "", `<div class="scroll"><table class="data"><thead><tr><th>Metric</th><th>Definition and limits</th>${report.repos.map((r) => `<th class="r">${e(r.slug)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`, true)}
</div>`;
  return shell(report, "methodology.html", "Methodology", "", body);
}
