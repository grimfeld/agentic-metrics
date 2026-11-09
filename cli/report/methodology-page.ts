// Methodology: `methodology.html`. Every metric present in a dataset, with its
// definition, its limits and its coverage per repo; then the raw datasets.
import { escapeHtml } from "../metrics/html.ts";
import { METRICS } from "../metrics/index.ts";
import { coverageText } from "../metrics/stats.ts";
import { MIN_ANONYMIZED_TICKETS } from "../trends.ts";
import { layout } from "./shell.ts";
import { PATHS, type PageContext } from "./site.ts";

export function methodologyPage(ctx: PageContext): string {
  const repos = ctx.site.repos;
  const entries = METRICS.flatMap((metric) => {
    const coverage = repos.flatMap(({ dataset }) => {
      const result = dataset.metrics[metric.id];
      return result ? [`${escapeHtml(dataset.repo)} ${coverageText(result.coverage)}`] : [];
    });
    if (coverage.length === 0) return [];
    return [`<article class="card" id="${metric.id}" data-methodology="${metric.id}"><h3>${escapeHtml(metric.name)}</h3>
<p>${metric.methodology.definition}</p>
<p><strong>Limits:</strong> ${metric.methodology.limits}</p>
<p><strong>Coverage:</strong> ${coverage.join("; ")}</p></article>`];
  }).join("\n");
  const links = repos
    .map((repo) => `<li><a href="${escapeHtml(ctx.link(PATHS.dataset(repo)))}">${escapeHtml(repo.dataset.repo)}</a> <small>${String(repo.dataset.tickets)} tickets · collected ${escapeHtml(repo.dataset.generatedAt.slice(0, 10))}</small></li>`)
    .join("");
  const anonymized = repos.some(({ dataset }) => dataset.publish === "anonymized")
    ? `\n<p>An anonymized repo's trends and comparison by autonomy level show a figure covering fewer than ${String(MIN_ANONYMIZED_TICKETS)} tickets as —: it would be those tickets' own numbers.</p>`
    : "";
  const body = `<section id="methodology" class="card" data-section="principles">
<p>Every number is derived from GitHub data and from the local cache of Claude Code transcripts, of which only counts reach the dataset. A metric whose source is missing is shown as <em>unknown</em>, never as zero. Coverage is the number of tickets a metric is computed over, out of the tickets delivered.</p>
<p>The overview's headline figures pool only the repos published in full: an anonymized dataset holds aggregates only, and medians can't be pooled.</p>${anonymized}
</section>
${entries}
<section class="card" data-section="raw-data"><h2>Raw data</h2>
${links ? `<ul class="datasets">${links}</ul>` : `<p class="muted">No dataset yet.</p>`}
</section>`;
  return layout(ctx, { title: "Methodology", body });
}
