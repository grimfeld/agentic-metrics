// A metric's page within a repo: `<repo>/<metric-id>.html`. For now, its
// definition and a link back to the repo; the metric page proper (chart,
// monthly trend, per-ticket table) replaces this.
import { escapeHtml } from "../metrics/html.ts";
import type { Metric } from "../metrics/metric.ts";
import { coverageText } from "../metrics/stats.ts";
import { chip, layout } from "./shell.ts";
import { PATHS, type PageContext, type SiteRepo } from "./site.ts";

export function metricPage(ctx: PageContext, repo: SiteRepo, metric: Metric<unknown>): string {
  const result = repo.dataset.metrics[metric.id];
  const back = ctx.link(PATHS.repo(repo));
  const body = `<section class="card" data-section="definition"><h2>Definition</h2>
<p>${metric.methodology.definition}</p>
<p><strong>Limits:</strong> ${metric.methodology.limits}</p>
${result ? `<p class="coverage">Computed over ${coverageText(result.coverage)}.</p>` : ""}
</section>
<p><a href="${escapeHtml(back)}">Back to ${escapeHtml(repo.dataset.repo)}</a></p>`;
  return layout(ctx, {
    title: `${metric.name} · ${repo.dataset.repo}`,
    heading: `${escapeHtml(metric.name)} <small>${escapeHtml(repo.dataset.repo)}</small>`,
    chips: chip(escapeHtml(repo.dataset.repo), back),
    body,
  });
}
