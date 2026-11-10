// The overview: `index.html`. Four headline tiles pooled across the repos
// published `full`, each naming the repos it covers and those it is unknown
// for; then a table comparing
// every repo, the CV-ready sentences, and a card per repo linking to its page.
// Anonymized repos are in the table, the sentences and the cards, never in
// the tiles.
import { escapeHtml } from "../metrics/html.ts";
import { UNKNOWN } from "../metrics/metric.ts";
import { coverageText, plural } from "../metrics/stats.ts";
import { cvSentences } from "./cv-sentences.ts";
import { HEADLINES, headlineValue } from "./headline.ts";
import { pooled } from "./pool.ts";
import { chip, layout } from "./shell.ts";
import { PATHS, type PageContext, type SiteRepo } from "./site.ts";

const CSS = `
[data-section="headlines"] { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
[data-section="headlines"] .tile { padding: 12px 14px; }
[data-section="headlines"] .tile h2 { font-size: 13px; white-space: normal; }
[data-section="headlines"] .tile .value { font-size: 28px; line-height: 1.2; }
[data-section="headlines"] .tile .coverage { font-size: 13px; }
.tile .covers { margin: 6px 0 0; font-size: 12px; color: var(--ink-2); }
.repo-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
.repo-card { display: block; text-decoration: none; background: var(--surface); border: 1px solid var(--ring); border-radius: 10px; padding: 12px 14px; }
.repo-card:hover { border-color: var(--axis); }
.repo-card h3 { margin: 0 0 4px; font-size: 15px; }
.repo-card p { margin: 0; font-size: 13px; color: var(--ink-2); }
[data-section="repos"] th, [data-section="repos"] td { white-space: nowrap; }
.sentences h3 { font-size: 13px; margin: 12px 0 4px; color: var(--ink-2); }
@media (max-width: 760px) { [data-section="headlines"] { grid-template-columns: repeat(2, minmax(0, 1fr)); } [data-section="headlines"] .tile .value { font-size: 22px; } }
`;

function tiles(ctx: PageContext): string {
  const datasets = ctx.site.repos.map((repo) => repo.dataset);
  const byRepo = new Map(ctx.site.repos.map((repo) => [repo.dataset.repo, repo]));
  return HEADLINES.map((metric) => {
    const { result, covers, unknownFor } = pooled(metric, datasets);
    const unknown = result.value === UNKNOWN ? " unknown" : "";
    const names = (list: typeof covers) =>
      list.flatMap((dataset) => {
        const repo = byRepo.get(dataset.repo);
        if (!repo) return [];
        // A repo whose dataset predates the metric has no page for it.
        const name = escapeHtml(dataset.repo);
        return [repo.metrics.includes(metric) ? `<a href="${escapeHtml(ctx.link(PATHS.metric(repo, metric)))}">${name}</a>` : name];
      });
    const missing = names(unknownFor);
    const coversText = covers.length ? `Covers ${names(covers).join(", ")}` : "No full repo has data";
    const unknownText = covers.length && missing.length ? `<p class="covers">Unknown for ${missing.join(", ")}</p>` : "";
    return `<article class="tile" data-headline="${metric.id}"><h2>${escapeHtml(metric.name)}</h2><p class="value${unknown}">${headlineValue(metric, result)}</p><p class="coverage">${coverageText(result.coverage)}</p><p class="covers">${coversText}</p>${unknownText}</article>`;
  }).join("\n");
}

function comparison(ctx: PageContext): string {
  const head = HEADLINES.map((metric) => `<th>${escapeHtml(metric.name)}</th>`).join("");
  const rows = ctx.site.repos
    .map((repo) => {
      const { dataset } = repo;
      const cells = HEADLINES.map((metric) => {
        const result = dataset.metrics[metric.id];
        return `<td>${headlineValue(metric, result)}${result ? `<br><small>${coverageText(result.coverage)}</small>` : ""}</td>`;
      }).join("");
      const name = escapeHtml(dataset.repo);
      return `<tr data-repo="${name}"><td><a href="${escapeHtml(ctx.link(PATHS.repo(repo)))}">${name}</a></td><td>${dataset.publish}</td><td>${String(dataset.tickets)}</td><td>${String(dataset.pullRequests)}</td>${cells}</tr>`;
    })
    .join("\n");
  return `<section class="card" data-section="repos"><h2>Repos</h2>
<p class="coverage">Each repo's own figures. An anonymized repo is shown under its alias, with aggregates only.</p>
<div class="scroll"><table><thead><tr><th>Repo</th><th>Published</th><th>Tickets</th><th>PRs</th>${head}</tr></thead><tbody>
${rows}
</tbody></table></div></section>`;
}

function sentences(ctx: PageContext): string {
  const groups = ctx.site.repos.flatMap(({ dataset }) => {
    const list = cvSentences(dataset);
    if (list.length === 0) return [];
    const items = list
      .map(({ key, text }) => {
        const escaped = escapeHtml(text);
        return `<li data-sentence="${escapeHtml(`${dataset.repo}:${key}`)}"><p class="sentence">${escaped}</p><button type="button" data-copy="${escaped}">Copy</button></li>`;
      })
      .join("\n");
    return [`<h3>${escapeHtml(dataset.repo)}</h3>\n<ul>\n${items}\n</ul>`];
  });
  if (groups.length === 0) return "";
  return `<section class="sentences card" data-section="cv-sentences"><h2>CV-ready sentences</h2>
<p class="coverage">Each quotes exactly what the data says, with its coverage. Unknown metrics are never quoted.</p>
${groups.join("\n")}
</section>`;
}

function repoCard(ctx: PageContext, repo: SiteRepo): string {
  const { dataset } = repo;
  const facts = [
    plural(dataset.tickets, "ticket"),
    `${plural(dataset.pullRequests, "PR")} merged`,
    `collected ${dataset.generatedAt.slice(0, 10)}`,
    dataset.publish === "anonymized" ? "anonymized" : "",
    repo.studies.length ? plural(repo.studies.length, "case study", "case studies") : "",
  ].filter(Boolean);
  return `<a class="repo-card" href="${escapeHtml(ctx.link(PATHS.repo(repo)))}"><h3>${escapeHtml(dataset.repo)}</h3><p>${escapeHtml(facts.join(" · "))}</p></a>`;
}

export function overviewPage(ctx: PageContext): string {
  const repos = ctx.site.repos;
  if (repos.length === 0) {
    return layout(ctx, {
      title: "Agentic metrics",
      heading: "Overview",
      body: `<p class="empty card">No repo tracked yet: run <code>agentic-metrics collect</code> and commit its dataset.</p>`,
    });
  }
  const tickets = repos.reduce((total, repo) => total + repo.dataset.tickets, 0);
  const latest = repos.map((repo) => repo.dataset.generatedAt).sort().at(-1)?.slice(0, 10) ?? "";
  const chips = [chip(plural(tickets, "ticket")), chip(plural(repos.length, "repo")), chip(`collected ${escapeHtml(latest)}`)].join("");
  const body = `<section class="tiles" data-section="headlines" aria-label="Headline figures, pooled over the repos published in full">
${tiles(ctx)}
</section>
${comparison(ctx)}
${sentences(ctx)}
<section data-section="repo-cards" aria-label="Repos"><div class="repo-cards">
${repos.map((repo) => repoCard(ctx, repo)).join("\n")}
</div></section>`;
  return layout(ctx, { title: "Agentic metrics", heading: "Overview", chips, body, css: CSS });
}
