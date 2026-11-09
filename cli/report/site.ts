// The report's site map: which pages there are and where each lives. Every
// page is rendered with a `PageContext`, which knows the page's own path and
// turns any site path into a link relative to it, so the site works from
// GitHub Pages under a sub-path and from `file://`.
//
//   index.html                              overview
//   methodology.html                        Methodology
//   <repo>/index.html                       a repo
//   <repo>/<metric-id>.html                 a metric of a repo
//   <repo>/case-studies/<n>.html            an approved case study (`full` repos only)
//   datasets/<owner>/<name>.json            the raw datasets, copied beside the pages
//
// `<repo>` is `owner--name`, or the alias of an anonymized repo.
import { posix } from "node:path";
import { draftFile, type CaseStudy } from "../case-studies.ts";
import { datasetPath, type Dataset } from "../dataset.ts";
import { METRICS } from "../metrics/index.ts";
import type { Metric } from "../metrics/metric.ts";

export interface SiteStudy {
  study: CaseStudy;
  /** `106`, `pr-136`: its draft's file name. */
  slug: string;
}

export interface SiteRepo {
  dataset: Dataset;
  /** Its folder in the site. */
  dir: string;
  /** The metrics its dataset holds, in report order: each has a page. */
  metrics: Metric<unknown>[];
  /** Its approved case studies; always none unless the repo is published `full`. */
  studies: SiteStudy[];
}

export interface Site {
  /** By repo name. */
  repos: SiteRepo[];
}

export function buildSite(datasets: readonly Dataset[], caseStudies: ReadonlyMap<string, readonly CaseStudy[]>): Site {
  const repos = [...datasets]
    .sort((a, b) => a.repo.localeCompare(b.repo))
    .map((dataset) => ({
      dataset,
      dir: dataset.repo.replace("/", "--"),
      metrics: METRICS.filter((metric) => dataset.metrics[metric.id] !== undefined),
      studies:
        dataset.publish === "full"
          ? (caseStudies.get(dataset.repo) ?? []).map((study) => ({ study, slug: draftFile(study.ticket).replace(/\.md$/, "") }))
          : [],
    }));
  return { repos };
}

/** Each page's path from the site's root. */
export const PATHS = {
  overview: "index.html",
  methodology: "methodology.html",
  repo: (repo: SiteRepo) => `${repo.dir}/index.html`,
  metric: (repo: SiteRepo, metric: Metric<unknown>) => `${repo.dir}/${metric.id}.html`,
  caseStudy: (repo: SiteRepo, study: SiteStudy) => `${repo.dir}/case-studies/${study.slug}.html`,
  dataset: (repo: SiteRepo) => `datasets/${datasetPath(repo.dataset.repo)}`,
};

export interface PageContext {
  site: Site;
  /** This page's path from the site's root. */
  path: string;
  /** A site path as a link from this page. */
  link(to: string): string;
}

export function pageContext(site: Site, path: string): PageContext {
  return {
    site,
    path,
    link: (to) => posix.relative(posix.dirname(path), to),
  };
}

/** A page written to the site: its path from the root, and its HTML. */
export interface Page {
  path: string;
  html: string;
}
