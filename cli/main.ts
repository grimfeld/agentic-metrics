// The `agentic-metrics` CLI: `collect` writes the current repo's dataset,
// `report` renders the datasets as a static HTML report.
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { readConfig } from "./config.ts";
import { buildDataset, datasetPath, SCHEMA_VERSION, type Dataset } from "./dataset.ts";
import { cachedSource, defaultCacheDir } from "./github/cache.ts";
import { loadGitHub } from "./github/load.ts";
import { ghSource, type GitHubSource } from "./github/source.ts";
import { link } from "./linker.ts";
import { renderReport } from "./report.ts";

export interface Dependencies {
  cwd: string;
  /** Defaults to the `gh` CLI. */
  github?: GitHubSource;
  /**
   * The local cache of raw GitHub items that makes collection incremental.
   * Defaults to ~/.cache/agentic-metrics with the `gh` source; with an
   * injected source, nothing is cached unless this is set.
   */
  cacheDir?: string;
  now?: () => Date;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

const USAGE = `Usage:
  agentic-metrics collect [--repo owner/name] [--datasets dir] [--full]
      Read the repo (default: the current one) through \`gh\` and write
      <dir>/<owner>/<name>.json (default dir: datasets).
      The first run reads the whole history; later runs read only what
      changed since, from a cache in ~/.cache/agentic-metrics. --full
      reads everything again (e.g. after a metric definition changes).
  agentic-metrics report [--datasets dir] [--out dir]
      Render every dataset in <dir> (default: datasets) as <out>/index.html
      (default out: report), with the datasets copied alongside.
`;

export async function main(argv: string[], deps: Dependencies): Promise<number> {
  const stdout = deps.stdout ?? ((text) => process.stdout.write(text));
  const stderr = deps.stderr ?? ((text) => process.stderr.write(text));
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "collect":
        await collect(rest, deps, stdout);
        return 0;
      case "report":
        await report(rest, deps, stdout);
        return 0;
      default:
        stderr(USAGE);
        return command === undefined || command === "--help" ? 0 : 2;
    }
  } catch (error) {
    stderr(`agentic-metrics: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function collect(args: string[], deps: Dependencies, stdout: (text: string) => void): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      repo: { type: "string" },
      datasets: { type: "string", default: "datasets" },
      full: { type: "boolean", default: false },
    },
  });
  const config = readConfig(deps.cwd);
  const now = deps.now ?? (() => new Date());
  const source = deps.github ?? ghSource({ cwd: deps.cwd, repo: values.repo });
  const cacheDir = deps.cacheDir ?? (deps.github ? undefined : defaultCacheDir());
  const github = cacheDir ? cachedSource(source, { dir: cacheDir, now, full: values.full }) : source;
  const data = await loadGitHub(github);
  const dataset = buildDataset(data.repo.fullName, link(data, config), now());

  const out = resolve(deps.cwd, values.datasets, datasetPath(dataset.repo));
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(dataset, null, 2)}\n`);
  stdout(`${dataset.repo}: ${String(dataset.tickets)} tickets, ${String(dataset.pullRequests)} PRs -> ${out}\n`);
}

async function report(args: string[], deps: Dependencies, stdout: (text: string) => void): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { datasets: { type: "string", default: "datasets" }, out: { type: "string", default: "report" } },
  });
  const datasetsDir = resolve(deps.cwd, values.datasets);
  const files = (await readdir(datasetsDir, { recursive: true })).filter((file) => file.endsWith(".json"));
  const datasets = await Promise.all(
    files.map(async (file) => {
      const dataset = JSON.parse(await readFile(join(datasetsDir, file), "utf8")) as Dataset;
      if (dataset.schemaVersion !== SCHEMA_VERSION) {
        throw new Error(`${file}: dataset schema ${String(dataset.schemaVersion)}, expected ${String(SCHEMA_VERSION)}; run collect again`);
      }
      return dataset;
    }),
  );
  if (datasets.length === 0) throw new Error(`no dataset in ${datasetsDir}; run collect first`);

  const out = resolve(deps.cwd, values.out);
  await mkdir(out, { recursive: true });
  await cp(datasetsDir, join(out, "datasets"), { recursive: true });
  await writeFile(join(out, "index.html"), renderReport(datasets));
  stdout(`${String(datasets.length)} datasets -> ${join(out, "index.html")}\n`);
}
