// The `agentic-metrics` CLI: `collect` writes the current repo's dataset,
// `report` renders the datasets as a static HTML report.
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { classifyAutonomy } from "./autonomy.ts";
import { CASE_STUDIES_DIR, readApproved, writeDrafts, type CaseStudy } from "./case-studies.ts";
import { CONFIG_FILE, readConfig } from "./config.ts";
import { buildDataset, datasetPath, SCHEMA_VERSION, type Dataset } from "./dataset.ts";
import { cachedSource, defaultCacheDir } from "./github/cache.ts";
import { loadGitHub } from "./github/load.ts";
import { ghSource, type GitHubSource } from "./github/source.ts";
import { link } from "./linker.ts";
import { renderReport } from "./report.ts";
import { linkSessions } from "./transcripts/link.ts";
import { loadSessions } from "./transcripts/load.ts";
import { noTranscripts, transcriptCache, type TranscriptSource } from "./transcripts/source.ts";

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
  /**
   * Defaults to the transcript cache (see cacheDir) for the clone at `cwd`,
   * or at `--checkout` with `--repo`; with an injected GitHub source, to none.
   */
  transcripts?: TranscriptSource;
  now?: () => Date;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

/** Where a repo published `none` gets its local report. */
const LOCAL_DIR = ".agentic-metrics-local";

const USAGE = `Usage:
  agentic-metrics collect [--repo owner/name [--checkout dir]] [--datasets dir] [--local dir] [--case-studies dir] [--full]
      Read the repo (default: the current one) through \`gh\` and write
      <dir>/<owner>/<name>.json (default dir: datasets), or <dir>/<alias>.json
      when the repo is published anonymized (the default for a private repo).
      A repo published \`none\` gets a local report in <local>/index.html
      (default local: ${LOCAL_DIR}) and nothing in <dir>.
      The first run reads the whole history; later runs read only what
      changed since, from a cache in ~/.cache/agentic-metrics. --full
      reads everything again (e.g. after a metric definition changes).
      Claude Code transcripts are read from the same cache, for the clone in
      the current folder, or in --checkout with --repo (without it, another
      repo's transcript metrics are unknown).
      A repo published \`full\` gets a case-study draft per candidate in
      <case-studies>/<owner>/<name>/ (default: case-studies); an existing
      draft is never overwritten.
  agentic-metrics report [--datasets dir] [--out dir] [--case-studies dir]
      Render every dataset in <dir> (default: datasets) as <out>/index.html
      (default out: report), with the datasets copied alongside, and the
      case studies marked \`approved: true\` of repos published \`full\`.
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
      local: { type: "string", default: LOCAL_DIR },
      full: { type: "boolean", default: false },
      checkout: { type: "string" },
      "case-studies": { type: "string", default: CASE_STUDIES_DIR },
    },
  });
  const config = readConfig(deps.cwd);
  const now = deps.now ?? (() => new Date());
  const source = deps.github ?? ghSource({ cwd: deps.cwd, repo: values.repo });
  const cacheDir = deps.cacheDir ?? (deps.github ? undefined : defaultCacheDir());
  const github = cacheDir ? cachedSource(source, { dir: cacheDir, now, full: values.full }) : source;
  const data = await loadGitHub(github);
  const publish = config.publish ?? (data.repo.private ? "anonymized" : "full");
  if (publish === "anonymized" && !config.alias) {
    throw new Error(
      `${data.repo.fullName} is published anonymized${config.publish ? "" : " (it is private)"}: set "alias" in ${CONFIG_FILE}, or set "publish"`,
    );
  }
  const checkout = values.checkout ?? (values.repo ? undefined : deps.cwd);
  const transcripts =
    deps.transcripts ??
    (deps.github || checkout === undefined ? noTranscripts : transcriptCache({ dir: cacheDir ?? defaultCacheDir(), repoDir: resolve(deps.cwd, checkout) }));
  const sessions = loadSessions(await transcripts.read());
  const work = classifyAutonomy(linkSessions(link(data, config), sessions, config, data.repo.fullName), config.autonomy);
  const dataset = buildDataset(data.repo, work, now(), publish, config.alias);

  // Only this collect's dataset may stay in the datasets folder: a dataset left
  // by an earlier mode would publish what the current mode hides.
  const datasetsDir = resolve(deps.cwd, values.datasets);
  const out = publish === "none" ? undefined : join(datasetsDir, datasetPath(dataset.repo));
  const candidates = [data.repo.fullName, ...(config.alias ? [config.alias] : [])].map((repo) => join(datasetsDir, datasetPath(repo)));
  for (const stale of candidates) if (stale !== out) await rm(stale, { force: true });

  // Only a `full` repo gets case-study drafts: they quote titles and descriptions.
  if (publish === "full" && dataset.caseStudyCandidates) {
    const drafts = await writeDrafts(join(resolve(deps.cwd, values["case-studies"]), dataset.repo), dataset.caseStudyCandidates, work);
    for (const draft of drafts) stdout(`case-study draft -> ${draft}\n`);
  }

  if (out) {
    await writeJson(out, dataset);
    stdout(`${dataset.repo}: ${String(dataset.tickets)} tickets, ${String(dataset.pullRequests)} PRs -> ${out}\n`);
    return;
  }
  const local = resolve(deps.cwd, values.local);
  await writeJson(join(local, "datasets", datasetPath(dataset.repo)), dataset);
  await writeFile(join(local, "index.html"), renderReport([dataset]));
  stdout(`${dataset.repo} (publish: none): ${String(dataset.tickets)} tickets, ${String(dataset.pullRequests)} PRs -> ${join(local, "index.html")}\n`);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function report(args: string[], deps: Dependencies, stdout: (text: string) => void): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      datasets: { type: "string", default: "datasets" },
      out: { type: "string", default: "report" },
      "case-studies": { type: "string", default: CASE_STUDIES_DIR },
    },
  });
  const datasetsDir = resolve(deps.cwd, values.datasets);
  const files = (await readdir(datasetsDir, { recursive: true })).filter((file) => file.endsWith(".json"));
  const read = await Promise.all(
    files.map(async (file) => {
      const dataset = JSON.parse(await readFile(join(datasetsDir, file), "utf8")) as Dataset;
      if (dataset.schemaVersion !== SCHEMA_VERSION) {
        throw new Error(`${file}: dataset schema ${String(dataset.schemaVersion)}, expected ${String(SCHEMA_VERSION)}; run collect again`);
      }
      return { file, dataset };
    }),
  );
  // A `none` dataset never belongs in the datasets folder; if one is there, it stays out of the report.
  const published = read.filter(({ dataset }) => dataset.publish !== "none");
  const datasets = published.map(({ dataset }) => dataset);
  if (datasets.length === 0) throw new Error(`no dataset in ${datasetsDir}; run collect first`);

  const out = resolve(deps.cwd, values.out);
  await mkdir(out, { recursive: true });
  for (const { file } of published) {
    await mkdir(dirname(join(out, "datasets", file)), { recursive: true });
    await cp(join(datasetsDir, file), join(out, "datasets", file));
  }
  // Approved case studies of `full` repos only; drafts are never copied to the report.
  const caseStudiesDir = resolve(deps.cwd, values["case-studies"]);
  const caseStudies = new Map<string, CaseStudy[]>();
  for (const dataset of datasets) {
    if (dataset.publish === "full") caseStudies.set(dataset.repo, await readApproved(join(caseStudiesDir, dataset.repo)));
  }
  await writeFile(join(out, "index.html"), renderReport(datasets, caseStudies));
  stdout(`${String(datasets.length)} datasets -> ${join(out, "index.html")}\n`);
}
