// Reading the report site in tests: a repo's page, Methodology, or every page.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A repo's page, from the site's root: `owner--name/index.html`, or `<alias>/index.html`. */
export function repoPage(repo: string): string {
  return `${repo.replace("/", "--")}/index.html`;
}

/** The HTML of `pages` under `site`, one after the other. */
export function readPages(site: string, pages: string[]): string {
  return pages.map((page) => readFileSync(join(site, page), "utf8")).join("\n");
}

/** A repo's page followed by Methodology: what the one-page report used to show of it. */
export function readRepo(site: string, repo: string): string {
  return readPages(site, [repoPage(repo), "methodology.html"]);
}

/** Every page of the site, for checks that hold across it. */
export function readAllPages(site: string): string {
  const pages = readdirSync(site, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => join(entry.parentPath, entry.name).slice(site.length + 1));
  return readPages(site, pages);
}
