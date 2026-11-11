// A repo's data coverage page: `<repo>/coverage.html`. Each metric's coverage,
// the gaps holding it back, and each gap with its fix (`gaps.ts`). An
// anonymized repo's gaps hold counts only, so its page names no ticket.
import type { Fix, Gap } from "../gaps.ts";
import { escapeHtml } from "../metrics/html.ts";
import { coverageText } from "../metrics/stats.ts";
import { chip, layout } from "./shell.ts";
import { PATHS, type PageContext, type SiteRepo } from "./site.ts";

const CSS = `
.gap { margin: 0 0 14px; } .gap:last-child { margin-bottom: 0; }
.gap .scope { color: var(--muted); font-variant-numeric: tabular-nums; }
.gap .fix code { white-space: pre-wrap; }
td.gaps { color: var(--ink-2); }
`;

/** Text content needs only `&`, `<` and `>` escaped; quotes stay readable (and `&#34;` would read like a ticket number). */
function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function scope(gap: Gap): string {
  return gap.tickets === undefined ? "repo" : `${String(gap.tickets)} ticket${gap.tickets === 1 ? "" : "s"}`;
}

function fixHtml(fix: Fix): string {
  switch (fix.kind) {
    case "command":
      return `Run <code>${escapeText(fix.command)}</code>`;
    case "config":
    case "convention":
    case "settings":
      return escapeText(fix.text);
    case "unfixable":
      return `Not fixable: ${escapeText(fix.reason)}`;
  }
}

export function coveragePage(ctx: PageContext, repo: SiteRepo): string {
  const { dataset } = repo;
  const gaps = dataset.gaps ?? [];
  const metricLink = (id: string) => {
    const metric = repo.metrics.find((m) => m.id === id);
    return metric ? `<a href="${escapeHtml(ctx.link(PATHS.metric(repo, metric)))}">${escapeHtml(metric.name)}</a>` : escapeHtml(id);
  };
  const rows = repo.metrics
    .map((metric) => {
      const result = dataset.metrics[metric.id];
      const held = gaps.filter((gap) => gap.metrics.includes(metric.id));
      const cell = held.length ? held.map((gap) => `<a href="#gap-${escapeHtml(gap.id)}">${escapeHtml(gap.id)}</a> (${scope(gap)})`).join("<br>") : "none";
      return `<tr data-metric="${metric.id}"><td>${metricLink(metric.id)}</td><td>${result ? coverageText(result.coverage) : "not measured yet"}</td><td class="gaps">${cell}</td></tr>`;
    })
    .join("\n");
  const list = gaps.length
    ? gaps
        .map((gap) => {
          const tickets = gap.ticketIds ? `<p class="muted">Tickets: ${gap.ticketIds.map(escapeHtml).join(", ")}</p>` : "";
          return `<article class="gap" id="gap-${escapeHtml(gap.id)}" data-gap="${escapeHtml(gap.id)}">
<p><span class="scope">[${scope(gap)}]</span> ${escapeText(gap.cause)}</p>
<p class="muted">Affects: ${gap.metrics.map(metricLink).join(", ")}</p>${tickets}
<p class="fix">${fixHtml(gap.fix)}</p>
</article>`;
        })
        .join("\n")
    : `<p>No gap: every metric has the data it needs.</p>`;
  const back = ctx.link(PATHS.repo(repo));
  const body = `<section class="card" data-section="coverage"><h2>Coverage by metric</h2>
<p class="coverage">How many delivered tickets each metric is known for, and the gaps that hold it back.</p>
<div class="scroll"><table><thead><tr><th>Metric</th><th>Coverage</th><th>Gaps</th></tr></thead><tbody>
${rows}
</tbody></table></div></section>
<section class="card" data-section="gaps"><h2>Gaps</h2>
<p class="coverage">Data a metric needs that is missing, why, and the one fix for each. Repo-level gaps first, then by tickets affected.</p>
${list}
</section>`;
  return layout(ctx, {
    title: `Data coverage · ${dataset.repo}`,
    heading: `Data coverage <small>${escapeHtml(dataset.repo)}</small>`,
    chips: [chip(escapeHtml(dataset.repo), back), chip(`${String(gaps.length)} gap${gaps.length === 1 ? "" : "s"}`)].join(""),
    body,
    css: CSS,
  });
}
