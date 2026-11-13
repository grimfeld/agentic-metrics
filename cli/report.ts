// The report: a static site rendered from the datasets. An overview, a page
// per repo, per metric of a repo and per approved case study, and
// Methodology, all in one shell (`report/shell.ts`) whose sidebar lists every
// page. `report/site.ts` holds the site map: each page kind's path, and the
// relative links between pages. The README says how to add a kind of page.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CaseStudy } from "./case-studies.ts";
import type { Dataset } from "./dataset.ts";
import { caseStudyPage } from "./report/case-study-page.ts";
import { coveragePage } from "./report/coverage-page.ts";
import { methodologyPage } from "./report/methodology-page.ts";
import { metricPage } from "./report/metric-page.ts";
import { overviewPage } from "./report/overview.ts";
import { repoPage } from "./report/repo-page.ts";
import { buildSite, pageContext, PATHS, type Page, type PageContext } from "./report/site.ts";

/** `caseStudies`: the approved case studies, by dataset repo; rendered for `full` datasets only. */
export function renderSite(datasets: readonly Dataset[], caseStudies: ReadonlyMap<string, readonly CaseStudy[]> = new Map()): Page[] {
  const site = buildSite(datasets, caseStudies);
  const page = (path: string, render: (ctx: PageContext) => string): Page => ({ path, html: render(pageContext(site, path)) });
  return [
    page(PATHS.overview, overviewPage),
    page(PATHS.methodology, methodologyPage),
    ...site.repos.flatMap((repo) => [
      page(PATHS.repo(repo), (ctx) => repoPage(ctx, repo)),
      page(PATHS.coverage(repo), (ctx) => coveragePage(ctx, repo)),
      ...repo.metrics.map((metric) => page(PATHS.metric(repo, metric), (ctx) => metricPage(ctx, repo, metric))),
      ...repo.studies.map((study) => page(PATHS.caseStudy(repo, study), (ctx) => caseStudyPage(ctx, repo, study))),
    ]),
  ];
}

/** Writes the site's pages under `out`; the datasets they link are the caller's to copy. */
export async function writeSite(out: string, datasets: readonly Dataset[], caseStudies?: ReadonlyMap<string, readonly CaseStudy[]>): Promise<void> {
  for (const { path, html } of renderSite(datasets, caseStudies)) {
    await mkdir(dirname(join(out, path)), { recursive: true });
    await writeFile(join(out, path), html);
  }
}
