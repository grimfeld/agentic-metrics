// PROTOTYPE (throwaway). Variant C, "Editorial story": a long read in four
// chapters (Speed, Quality, Autonomy, Cost), each one sentence and one chart;
// case studies as cards; numbers set in the prose rather than in tiles.
import { autonomyChart, autonomyMix, autonomySentence, cov, definition, distChart, e, limits, methodEntries, rawLink, ticketTable, trendChart, trendSentence, trendTable, val, weeklyChart } from "./common.ts";
import { GROUPS, monthShort, type MetricView, type Report, type RepoView, type Study } from "./data.ts";

export const css = `
.vc { background: var(--surface); min-height: 100vh; }
.vc .mast { border-bottom: 1px solid var(--grid); }
.vc .mast .in { max-width: 1040px; margin: 0 auto; padding: 14px 16px; display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: var(--ink-2); flex-wrap: wrap; }
.vc .mast a { text-decoration: none; } .vc .mast b { color: var(--ink); letter-spacing: .02em; }
.vc .mast nav { display: flex; gap: 16px; flex-wrap: wrap; }
.vc .hero { max-width: 1040px; margin: 0 auto; padding: 56px 16px 40px; }
.vc .kick { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; color: var(--accent-ink); margin: 0 0 12px; }
.vc .hero h1 { font-size: clamp(32px, 6vw, 56px); line-height: 1.05; letter-spacing: -0.025em; margin: 0 0 20px; max-width: 18ch; }
.vc .hero .stand { font-size: clamp(18px, 2.4vw, 22px); line-height: 1.45; color: var(--ink-2); max-width: 40em; margin: 0; }
.vc .toc { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 28px; }
.vc .toc a { text-decoration: none; border: 1px solid var(--grid); border-radius: 999px; padding: 4px 14px; font-size: 14px; }
.vc .toc a:hover { border-color: var(--axis); }
.vc section.ch { border-top: 1px solid var(--grid); }
.vc section.ch .in { max-width: 1040px; margin: 0 auto; padding: 48px 16px; display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 40px; align-items: start; }
.vc section.ch h2 { font-size: clamp(24px, 3.4vw, 34px); line-height: 1.15; letter-spacing: -0.015em; margin: 0 0 14px; }
.vc section.ch .num { font-size: 13px; color: var(--muted); font-weight: 600; letter-spacing: .1em; }
.vc section.ch p { font-size: 17px; line-height: 1.6; color: var(--ink-2); margin: 0 0 12px; }
.vc section.ch .fig figcaption { font-size: 13px; color: var(--muted); margin-top: 6px; }
.vc .also { font-size: 14px; margin-top: 16px; padding: 0; list-style: none; }
.vc .also li { padding: 6px 0; border-top: 1px solid var(--grid); display: flex; justify-content: space-between; gap: 12px; }
.vc .also a { text-decoration: none; } .vc .also a:hover { text-decoration: underline; }
.vc .cards { max-width: 1040px; margin: 0 auto; padding: 48px 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.vc .cards h2 { grid-column: 1 / -1; font-size: 28px; margin: 0; letter-spacing: -0.015em; }
.vc .cards a.cs { display: flex; flex-direction: column; gap: 10px; text-decoration: none; border: 1px solid var(--grid); border-radius: 14px; padding: 18px; background: var(--plane); }
.vc .cards a.cs:hover { border-color: var(--axis); }
.vc .cards a.cs h3 { font-size: 18px; line-height: 1.3; margin: 0; }
.vc .cards a.cs dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0; font-size: 13px; }
.vc .cards a.cs dt { color: var(--muted); } .vc .cards a.cs dd { margin: 0; }
.vc .article { max-width: 720px; margin: 0 auto; padding: 0 16px 56px; }
.vc .article h2 { font-size: 24px; margin: 48px 0 8px; letter-spacing: -0.01em; }
.vc .article p { font-size: 18px; line-height: 1.6; }
.vc .article .wide { margin: 24px -16px; padding: 16px; background: var(--plane); border-radius: 12px; }
.vc .article aside { border-left: 3px solid var(--s1); padding: 4px 0 4px 16px; color: var(--ink-2); font-size: 15px; margin: 32px 0; }
.vc .article aside b { color: var(--ink); }
.vc .side-nums { display: flex; flex-wrap: wrap; gap: 12px 32px; padding: 16px 0; margin: 0 0 24px; border-top: 1px solid var(--grid); border-bottom: 1px solid var(--grid); list-style: none; }
.vc .side-nums li { font-size: 13px; color: var(--muted); } .vc .side-nums b { display: block; font-size: 22px; color: var(--ink); font-weight: 650; }
.vc .prose { font-size: 17px; line-height: 1.6; }
.vc footer { border-top: 1px solid var(--grid); }
.vc footer .in { max-width: 1040px; margin: 0 auto; padding: 24px 16px; font-size: 13px; color: var(--muted); }
@media (max-width: 760px) { .vc section.ch .in { grid-template-columns: 1fr; gap: 20px; padding: 36px 16px; } .vc .hero { padding-top: 32px; } .vc .article .wide { margin: 24px 0; padding: 12px; } }
`;

function mast(report: Report): string {
  const repos = report.repos.map((r) => `<a href="${r.page}">${e(r.slug)}</a>`).join("");
  return `<div class="mast"><div class="in"><a href="index.html"><b>AGENTIC METRICS</b></a><nav>${repos}<a href="methodology.html">Methodology</a></nav></div></div>`;
}

function foot(report: Report): string {
  return `<footer><div class="in">Collected ${e(report.generatedAt)} from GitHub and Claude Code transcripts. Grey <span class="unknown">unknown</span> means no source data, not zero. Every figure states its coverage, “N of M tickets”. <a href="methodology.html">Methodology</a>.</div></footer>`;
}

interface Chapter { n: number; key: string; title: string; text: string; fig: string; caption: string; also: MetricView[] }

function chapters(r: RepoView): Chapter[] {
  const m = (id: string) => r.byId.get(id);
  const also = (key: string, skip: string[]) =>
    (GROUPS.find((g) => g.key === key)?.metrics ?? []).flatMap((id) => (m(id) && !skip.includes(id) ? [m(id) as MetricView] : []));
  const lead = m("leadTime"), ci = m("firstRunCiRate"), hm = m("humanMessagesPerTicket"), cost = m("apiEquivalentCost"), reg = m("regressionRate"), auto = m("autonomy");
  const out: Chapter[] = [];
  if (lead) {
    const t = trendSentence(r, "leadTime");
    out.push({
      n: 1, key: "speed",
      title: lead.known ? `Half of all tickets merge within ${lead.big} of being ready.` : "Lead time is unknown.",
      text: `${e(lead.sentence ?? "")} ${t ? e(t) : ""}`,
      fig: lead.perTicket ? distChart(lead, 220) : trendChart(lead, 220),
      caption: lead.perTicket ? `Tickets by lead time, ${lead.coverage}.` : `Lead time p50 by month.`,
      also: also("speed", []),
    });
  }
  if (ci) {
    out.push({
      n: 2, key: "quality",
      title: ci.known ? `${ci.big} of pull requests pass CI first time.` : "First-run CI is unknown here.",
      text: `${e(ci.sentence ?? "")} ${reg?.sentence ? e(reg.sentence) : ""}`,
      fig: trendChart(ci, 220),
      caption: `First-run CI rate by month, with each month’s coverage. Months with no CI data say unknown.`,
      also: also("quality", []),
    });
  }
  if (hm) {
    out.push({
      n: 3, key: "autonomy",
      title: hm.known ? `A median of ${hm.big} human messages per ticket.` : "Human messages per ticket are unknown.",
      text: `${e(hm.sentence ?? "")} ${auto?.sentence ? e(auto.sentence) : ""} ${autonomySentence(r, "humanMessagesPerTicket") ? e(autonomySentence(r, "humanMessagesPerTicket") ?? "") : ""}`,
      fig: hm.byLevel ? autonomyChart(hm) + `<div style="margin-top:20px">${autonomyMix(r)}</div>` : autonomyMix(r),
      caption: `Top: human messages per ticket (p50) at each autonomy level. Bottom: how many tickets sit at each level.`,
      also: also("autonomy", []),
    });
  }
  if (cost) {
    out.push({
      n: 4, key: "cost",
      title: cost.known ? `About ${cost.big} of API-equivalent compute per ticket.` : "Cost is unknown.",
      text: `${e(cost.sentence ?? "")} ${autonomySentence(r, "apiEquivalentCost") ? e(autonomySentence(r, "apiEquivalentCost") ?? "") : ""}`,
      fig: cost.byLevel ? autonomyChart(cost) : trendChart(cost),
      caption: `API-equivalent cost per ticket (p50) by autonomy level, at list prices.`,
      also: also("cost", []),
    });
  }
  return out;
}

function chapterHtml(c: Chapter, label: string): string {
  const also = c.also.map((m) => `<li><a href="${m.page}">${e(m.name)} →</a><span>${val(m.big)} ${cov(`· ${m.coverage}`)}</span></li>`).join("");
  return `<section class="ch" id="${c.key}"><div class="in"><div><div class="num">${String(c.n).padStart(2, "0")} · ${e(label.toUpperCase())}</div><h2>${e(c.title)}</h2><p>${c.text}</p><ul class="also">${also}</ul></div><figure class="fig" style="margin:0">${c.fig}<figcaption>${c.caption}</figcaption></figure></div></section>`;
}

function studyCards(r: RepoView, title = "Stories from the work"): string {
  if (!r.studies.length) return "";
  const cards = r.studies.map((s) => `<a class="cs" href="${s.page}"><span class="kick" style="margin:0">${e(s.criteria)}</span><h3>${e(s.title)}</h3><dl>${s.numbers.slice(0, 3).map((n) => `<dt>${e(n.label)}</dt><dd>${val(n.value)}</dd>`).join("")}</dl></a>`).join("");
  return `<div style="border-top:1px solid var(--grid)"><div class="cards"><h2>${e(title)}</h2>${cards}</div></div>`;
}

export function index(report: Report): string {
  const main = report.repos[0];
  const lead = report.headlines[0], ci = report.headlines[1], hm = report.headlines[2], reg = report.headlines[3];
  const stand = `Over ${e(monthShort(report.months[0] ?? ""))} to ${e(monthShort(report.months.at(-1) ?? ""))}, across ${String(report.repos.length)} repos, the median ticket went from ready to merged in <b>${val(lead?.big ?? "unknown")}</b>; <b>${val(ci?.big ?? "unknown")}</b> of pull requests passed CI first time; I typed a median of <b>${val(hm?.big ?? "unknown")}</b> messages per ticket; and <b>${val(reg?.big ?? "unknown")}</b> of tickets regressed. <span class="cov">(${e(lead?.coverage ?? "")}; messages over ${e(hm?.coverage ?? "")})</span>`;
  const chs = main ? chapters(main).map((c) => chapterHtml(c, GROUPS.find((g) => g.key === c.key)?.name ?? "")).join("") : "";
  const others = report.repos.slice(1).map((r) => `<li><a href="${r.page}">${e(r.name)} →</a><span>${String(r.ds.tickets)} tickets ${cov(`· lead time p50 ${r.byId.get("leadTime")?.big ?? "unknown"}`)}</span></li>`).join("");
  return `<div class="vc">${mast(report)}
<div class="hero"><p class="kick">An agentic engineering workflow, measured</p><h1>${String(report.totalTickets)} tickets, shipped by agents I steer.</h1><p class="stand">${stand}</p>
<div class="toc">${GROUPS.map((g) => `<a href="#${g.key}">${e(g.name)}</a>`).join("")}</div></div>
${main ? `<div class="hero" style="padding:0 16px 16px"><p class="kick" style="color:var(--muted)">The four chapters below follow ${e(main.name)}, the main repo</p></div>` : ""}
${chs}
${main ? studyCards(main) : ""}
${others ? `<section class="ch"><div class="in"><div><div class="num">ALSO MEASURED</div><h2>Other repos</h2></div><ul class="also">${others}</ul></div></section>` : ""}
${foot(report)}</div>`;
}

export function repo(report: Report, r: RepoView): string {
  const chs = chapters(r).map((c) => chapterHtml(c, GROUPS.find((g) => g.key === c.key)?.name ?? "")).join("");
  const thr = r.byId.get("throughput");
  return `<div class="vc">${mast(report)}
<div class="hero"><p class="kick">${e(r.name)}</p><h1>${String(r.ds.tickets)} tickets in ${String(r.ds.pullRequests)} pull requests.</h1><p class="stand">${thr?.sentence ? e(thr.sentence) : ""} ${r.url ? `<a href="${e(r.url)}">On GitHub</a>.` : ""}</p>
<div style="margin-top:28px">${weeklyChart(r, 150)}</div>
<div class="toc">${GROUPS.map((g) => `<a href="#${g.key}">${e(g.name)}</a>`).join("")}</div></div>
${chs}
${studyCards(r)}
${foot(report)}</div>`;
}

export function metric(report: Report, r: RepoView, m: MetricView): string {
  const group = GROUPS.find((g) => (g.metrics as readonly string[]).includes(m.id));
  const dist = distChart(m, 220);
  const auto = autonomyChart(m);
  const t = trendSentence(r, m.id);
  const a = autonomySentence(r, m.id);
  return `<div class="vc">${mast(report)}
<div class="hero" style="max-width:720px"><p class="kick"><a href="${r.page}#${group?.key ?? ""}" style="text-decoration:none">${e(r.slug)} · ${e(group?.name ?? "")}</a> · ${e(m.name)}</p>
<h1 style="max-width:none;font-size:clamp(28px,5vw,44px)">${m.sentence ? e(m.sentence.replace(/, over .*$/, ".")) : `${e(m.name)}: ${val(m.big)}`}</h1>
<p class="stand">${definition(m).split(/(?<=\.) /)[0] ?? ""}</p><p>${cov(m.coverage)}</p></div>
<div class="article">
${dist ? `<div class="wide">${dist}</div><p class="cov">Each column counts tickets in a range. ${e(m.coverage)}.</p>` : ""}
<h2>Over time</h2><p>${t ? e(t) : "Not enough months to speak of a trend."}</p><div class="wide">${trendChart(m)}</div>
${auto ? `<h2>By autonomy level</h2><p>${a ? e(a) : ""}</p><div class="wide">${auto}</div>` : ""}
<h2>How it’s measured</h2><p style="font-size:16px">${definition(m)}</p><aside><b>Caveats.</b> ${limits(m)}</aside>
<details><summary>The data: ${m.perTicket ? `all ${String(m.perTicket.rows.length)} tickets` : "detail"}, and month by month</summary>${ticketTable(m)}<div style="margin-top:16px">${trendTable(m)}</div></details>
</div>${foot(report)}</div>`;
}

export function study(report: Report, r: RepoView, s: Study): string {
  return `<div class="vc">${mast(report)}
<div class="hero" style="max-width:720px"><p class="kick"><a href="${r.page}" style="text-decoration:none">${e(r.slug)}</a> · Case study · ${e(s.criteria)}</p><h1 style="max-width:none;font-size:clamp(28px,5vw,44px)">${e(s.title)}</h1></div>
<div class="article"><ul class="side-nums">${s.numbers.map((n) => `<li>${e(n.label)}<b>${val(n.value.replace(/ \(.*$/, ""))}</b></li>`).join("")}</ul><article class="prose">${s.html}</article></div>
${foot(report)}</div>`;
}

export function methodology(report: Report): string {
  const chs = GROUPS.map((g, i) => {
    const entries = methodEntries(report, g.metrics)
      .map(({ m, per }) => `<h2 id="${m.id}" style="font-size:20px">${e(m.name)}</h2><p>${definition(m)}</p><aside><b>Limits.</b> ${limits(m)}</aside><p class="cov">Coverage: ${per.map((p) => `${e(p.r.slug)} ${e(p.m.coverage)}${p.m.known ? "" : " (unknown)"}`).join(" · ")}</p>`)
      .join("");
    return `<p class="kick" style="margin-top:56px">${String(i + 1).padStart(2, "0")} · ${e(g.name)}</p>${entries}`;
  }).join("");
  return `<div class="vc">${mast(report)}
<div class="hero" style="max-width:720px"><p class="kick">Methodology</p><h1 style="max-width:none">How every number here is made.</h1><p class="stand">From GitHub data and the local cache of Claude Code transcripts, of which only counts leave the machine. Where a source is missing the number is <span class="unknown">unknown</span>, never zero, and every figure carries its coverage.</p></div>
<div class="article"><h2>Raw data</h2><p>${report.repos.map((r) => `<a href="${rawLink(r)}">${e(r.name)}.json</a>`).join(" · ")}</p>${chs}</div>
${foot(report)}</div>`;
}
