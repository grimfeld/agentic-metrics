// A repo's page: `<repo>/index.html`. For now it holds what the one-page
// report showed per repo (headline cards, trends, the comparison by autonomy
// level, CV-ready sentences, each metric's section and the delivered
// tickets), with each metric's heading linking to its page and the approved
// case studies listed. The dashboard layout of the repo page replaces this.
import { escapeHtml } from "../metrics/html.ts";
import type { Metric } from "../metrics/metric.ts";
import { UNKNOWN } from "../metrics/metric.ts";
import { coverageText } from "../metrics/stats.ts";
import { autonomySection, sentenceSection, trendSection } from "../report-trends.ts";
import { HEADLINES, headlineValue } from "./headline.ts";
import { chip, layout } from "./shell.ts";
import { PATHS, type PageContext, type SiteRepo } from "./site.ts";

const CSS = `
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; margin-bottom: 12px; }
.cards .card { margin: 0; }
.cards .card h3 { margin: 0; font-size: 13px; font-weight: 500; color: var(--ink-2); }
.cards .card .value { margin: 4px 0; font-size: 22px; font-weight: 650; }
.studies ul, .tickets ul { padding-left: 20px; }
`;

function card(repo: SiteRepo, metric: Metric<unknown>): string {
  const result = repo.dataset.metrics[metric.id];
  const unknown = !result || result.value === UNKNOWN ? " unknown" : "";
  const coverage = result ? coverageText(result.coverage) : "not measured yet";
  return `<article class="card" data-metric="${metric.id}"><h3>${escapeHtml(metric.name)}</h3><p class="value${unknown}">${headlineValue(metric, result)}</p><p class="coverage">${coverage}</p></article>`;
}

function metricSections(ctx: PageContext, repo: SiteRepo): string {
  return repo.metrics
    .flatMap((metric) => {
      const result = repo.dataset.metrics[metric.id];
      if (!metric.section || !result) return [];
      const body = result.value === UNKNOWN ? `<p class="unknown">unknown</p>` : metric.section(result.value);
      const heading = `<a href="${escapeHtml(ctx.link(PATHS.metric(repo, metric)))}">${escapeHtml(metric.name)}</a>`;
      return [`<section class="metric card" data-section="${metric.id}"><h3>${heading}</h3>${body}</section>`];
    })
    .join("\n");
}

function studyList(ctx: PageContext, repo: SiteRepo): string {
  if (repo.studies.length === 0) return "";
  const items = repo.studies
    .map((s) => `<li><a href="${escapeHtml(ctx.link(PATHS.caseStudy(repo, s)))}">Case study ${escapeHtml(s.study.ticket)}</a></li>`)
    .join("");
  return `<section class="studies card" data-section="case-studies"><h3>Case studies</h3><ul>${items}</ul></section>`;
}

/** The delivered tickets with their titles and links, latest first; only a `full` dataset has them. */
function ticketList(repo: SiteRepo): string {
  const tickets = repo.dataset.ticketList;
  if (!tickets?.length) return "";
  const items = [...tickets]
    .reverse()
    .map((ticket) => {
      const label = `${escapeHtml(ticket.id)} ${escapeHtml(ticket.title)}`;
      const linked = ticket.url ? `<a href="${escapeHtml(ticket.url)}">${label}</a>` : label;
      return `<li>${linked} <small>${escapeHtml(ticket.doneAt.slice(0, 10))}</small></li>`;
    })
    .join("");
  return `<details class="tickets card" data-section="tickets"><summary>Tickets delivered (${String(tickets.length)})</summary><ul>${items}</ul></details>`;
}

export function repoPage(ctx: PageContext, repo: SiteRepo): string {
  const { dataset } = repo;
  const name = escapeHtml(dataset.repo);
  const chips = [
    chip(`${String(dataset.tickets)} tickets`),
    chip(`${String(dataset.pullRequests)} PRs merged`),
    chip(`collected ${escapeHtml(dataset.generatedAt.slice(0, 10))}`),
    dataset.url ? chip("GitHub", dataset.url) : "",
    chip("raw dataset", ctx.link(PATHS.dataset(repo))),
  ].join("");
  const body = `<section class="repo" id="${name}" data-repo="${name}">
<div class="cards">
${HEADLINES.map((metric) => card(repo, metric)).join("\n")}
</div>
${wrap(trendSection(dataset))}
${wrap(autonomySection(dataset))}
${wrap(sentenceSection(dataset))}
${metricSections(ctx, repo)}
${studyList(ctx, repo)}
${ticketList(repo)}
</section><!-- /repo -->`;
  return layout(ctx, { title: dataset.repo, chips, body, css: CSS });
}

/** A summary section as a card. */
function wrap(section: string): string {
  return section.replace(/^<section class="([^"]*)"/, '<section class="$1 card"');
}
