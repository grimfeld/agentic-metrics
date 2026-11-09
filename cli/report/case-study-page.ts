// An approved case study's page: `<repo>/case-studies/<n>.html`, for `full`
// repos only. For now, its Markdown and a link back to the repo.
import { renderMarkdown } from "../markdown.ts";
import { escapeHtml } from "../metrics/html.ts";
import { chip, layout } from "./shell.ts";
import { PATHS, type PageContext, type SiteRepo, type SiteStudy } from "./site.ts";

const CSS = `
.case-study h4 { font-size: 20px; margin: 1.2em 0 .4em; } .case-study h4:first-child { margin-top: 0; }
.case-study h5 { font-size: 16px; margin: 1.2em 0 .3em; } .case-study h6 { font-size: 15px; margin: 1em 0 .3em; }
.case-study blockquote { margin: 0; padding-left: 12px; border-left: 2px solid var(--axis); color: var(--ink-2); }
.case-study pre { margin: 0 0 1em; padding: 10px 12px; overflow-x: auto; background: var(--plane); border: 1px solid var(--grid); border-radius: 6px; font-size: 13px; line-height: 1.45; }
.case-study pre code { font-size: inherit; }
`;

export function caseStudyPage(ctx: PageContext, repo: SiteRepo, { study }: SiteStudy): string {
  const back = ctx.link(PATHS.repo(repo));
  const body = `<article class="case-study card" data-ticket="${escapeHtml(study.ticket)}">${renderMarkdown(study.markdown)}</article>
<p><a href="${escapeHtml(back)}">Back to ${escapeHtml(repo.dataset.repo)}</a></p>`;
  return layout(ctx, {
    title: `Case study ${study.ticket} · ${repo.dataset.repo}`,
    heading: `Case study ${escapeHtml(study.ticket)} <small>${escapeHtml(repo.dataset.repo)}</small>`,
    chips: chip(escapeHtml(repo.dataset.repo), back),
    body,
    css: CSS,
  });
}
