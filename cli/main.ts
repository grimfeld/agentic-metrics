// The `agentic-metrics` CLI: `collect` writes the current repo's dataset,
// `report` renders the datasets as a static HTML report, `init` onboards a repo.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";
import { classifyAutonomy } from "./autonomy.ts";
import { CASE_STUDIES_DIR, readApproved, writeDrafts, type CaseStudy } from "./case-studies.ts";
import { CONFIG_FILE, configuredFields, readConfig, type Config } from "./config.ts";
import { inferConventions, withInferred } from "./infer.ts";
import { revertRegressions } from "./inferred-regressions.ts";
import { buildDataset, datasetPath, SCHEMA_VERSION, type Dataset } from "./dataset.ts";
import { defaultClaudeDir, deviceGaps, formatDoctor, thisDevice } from "./doctor.ts";
import { findGaps, inspectCheckout, type Gap } from "./gaps.ts";
import { cachedSource, defaultCacheDir } from "./github/cache.ts";
import { loadGitHub, type GitHubData } from "./github/load.ts";
import { ghAdmin, init, type RepoAdmin } from "./init.ts";
import { ghSource, type GitHubSource } from "./github/source.ts";
import { link, type LinkedWork } from "./linker.ts";
import { linkRecords } from "./records.ts";
import { writeSite } from "./report.ts";
import { importTranscripts } from "./transcripts/import.ts";
import { linkSessions } from "./transcripts/link.ts";
import { loadSessions } from "./transcripts/load.ts";
import { noTranscripts, transcriptCache, type TranscriptSource } from "./transcripts/source.ts";

export interface Dependencies {
  cwd: string;
  /** Defaults to the `gh` CLI. */
  github?: GitHubSource;
  /** The repo settings `init` reads and changes (visibility, labels). Defaults to the `gh` CLI. */
  admin?: RepoAdmin;
  /** The CLI's version, whose release `init` pins the Action to. Defaults to package.json's. */
  version?: string;
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
  /** The `owner/name` of the GitHub repo cloned at `dir`, if any. Defaults to its git `origin` remote. */
  localRepo?: (dir: string) => Promise<string | undefined>;
  /** Claude Code's user folder, which `doctor` reads this device's settings from. Defaults to ~/.claude. */
  claudeDir?: string;
  /** The user's config folder, where the recorder keeps this device's id. Defaults to $XDG_CONFIG_HOME, else ~/.config. */
  configDir?: string;
  now?: () => Date;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

/** Where a repo published `none` gets its local report. */
const LOCAL_DIR = ".agentic-metrics-local";

const USAGE = `Usage:
  agentic-metrics init [--alias name] [--publish full|anonymized|none]
      Onboard the current repo: write ${CONFIG_FILE} with every field set
      (Dependabot excluded; publish anonymized for a private repo, under
      --alias or a random alias), create the \`regression\`
      and \`autonomy:*\` labels, and install the GitHub Action workflow,
      pinned to the commit of this version's release tag (else of main).
      Prints the pattern to allow when the repo allows only selected actions.
      Safe to run again: an existing config or workflow is kept.
  agentic-metrics collect [--repo owner/name [--checkout dir]] [--datasets dir] [--local dir] [--case-studies dir] [--full]
      Read the repo (default: the current one) through \`gh\` and write
      <dir>/<owner>/<name>.json (default dir: datasets), or <dir>/<alias>.json
      when the repo is published anonymized (the default for a private repo).
      A repo published \`none\` gets a local report in <local>/index.html
      (default local: ${LOCAL_DIR}) and nothing in <dir>.
      The first run reads the whole history; later runs read only what
      changed since, from a cache in ~/.cache/agentic-metrics. --full
      reads everything again (e.g. after a metric definition changes).
      The repo's clone, the current folder or --checkout with --repo, holds
      its ${CONFIG_FILE} and names its Claude Code transcripts (read from
      the same cache). --repo naming another repo than the current folder's
      without --checkout reads the current folder's config and no transcripts,
      with a warning.
      A repo published \`full\` gets a case-study draft per candidate in
      <case-studies>/<owner>/<name>/ (default: case-studies); an existing
      draft is never overwritten.
  agentic-metrics doctor [--repo owner/name [--checkout dir]]
      Print the repo's gaps, largest first: data a metric needs that is
      missing, why, and the one fix for each; then this device's (whether the
      plugin caches its transcripts, and how long Claude Code keeps them).
      Reads the repo as collect does and changes nothing: no dataset, no file
      in the repo, nothing on GitHub or in ~/.claude.
  agentic-metrics import-transcripts <folder> [--checkout dir] [--name clone-folder]... [--dry-run]
      Bring another device's Claude Code transcripts of this repo into this
      device's transcript cache, so that collect reads them. <folder> is that
      device's ~/.cache/agentic-metrics or ~/.claude/projects, copied here.
      Its project folders named after the clone (the current folder's name,
      or --checkout's; --name when the clone is called something else there)
      are copied under the local clone's name, worktrees included. A
      transcript already in the cache is kept unless the imported one is
      longer. --dry-run lists what would be copied.
  agentic-metrics report [--datasets dir] [--out dir] [--case-studies dir]
      Render every dataset in <dir> (default: datasets) as a static site in
      <out> (default: report): an overview (index.html), a page per repo, per
      metric and per case study marked \`approved: true\` of a repo published
      \`full\`, and methodology.html, with the datasets copied alongside.
`;

export async function main(argv: string[], deps: Dependencies): Promise<number> {
  const stdout = deps.stdout ?? ((text) => process.stdout.write(text));
  const stderr = deps.stderr ?? ((text) => process.stderr.write(text));
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "collect":
        await collect(rest, deps, stdout, stderr);
        return 0;
      case "report":
        await report(rest, deps, stdout);
        return 0;
      case "doctor":
        await doctor(rest, deps, stdout, stderr);
        return 0;
      case "init":
        await initCommand(rest, deps, stdout);
        return 0;
      case "import-transcripts":
        await importCommand(rest, deps, stdout);
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

interface Gathered {
  config: Config;
  data: GitHubData;
  work: LinkedWork;
  gaps: Gap[];
}

/**
 * Reads and links a repo as `collect` and `doctor` both do: its config and
 * transcripts from its clone (the current folder, unless --repo names another
 * repo and --checkout is not given), and GitHub through the cache.
 */
async function gather(
  values: { repo?: string | undefined; checkout?: string | undefined; full?: boolean | undefined },
  deps: Dependencies,
  stderr: (text: string) => void,
): Promise<Gathered> {
  const checkout =
    values.checkout ??
    (!values.repo || sameRepo(await (deps.localRepo ?? originRepo)(deps.cwd), values.repo) ? deps.cwd : undefined);
  const configDir = checkout === undefined ? deps.cwd : resolve(deps.cwd, checkout);
  const configured = readConfig(configDir);
  if (values.repo && checkout === undefined) {
    stderr(
      `agentic-metrics: ${values.repo} has no --checkout: reading ${CONFIG_FILE} from ${deps.cwd}, and its transcript metrics are unknown. Pass --checkout <its clone>.\n`,
    );
  }
  const now = deps.now ?? (() => new Date());
  const source = deps.github ?? ghSource({ cwd: deps.cwd, repo: values.repo });
  const cacheDir = deps.cacheDir ?? (deps.github ? undefined : defaultCacheDir());
  const github = cacheDir ? cachedSource(source, { dir: cacheDir, now, full: values.full ?? false }) : source;
  const data = await loadGitHub(github);
  // The conventions the config doesn't set, inferred from the history (`infer.ts`).
  const inferred = inferConventions(data, configuredFields(configDir));
  const config = withInferred(configured, inferred);
  const transcripts =
    deps.transcripts ??
    (deps.github || checkout === undefined
      ? noTranscripts
      : transcriptCache({ dir: cacheDir ?? defaultCacheDir(), repoDir: resolve(deps.cwd, checkout), repo: data.repo.fullName }));
  const sessions = loadSessions(await transcripts.read());
  const linked = classifyAutonomy(linkRecords(linkSessions(link(data, config), sessions, config, data.repo.fullName), sessions), config.autonomy);
  const work = { ...linked, inferredRegressions: revertRegressions(linked) };
  const gaps = findGaps({ work, data, config, inferred, checkout: checkout === undefined ? undefined : inspectCheckout(resolve(deps.cwd, checkout)) });
  return { config, data, work, gaps };
}

async function collect(args: string[], deps: Dependencies, stdout: (text: string) => void, stderr: (text: string) => void): Promise<void> {
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
  const { config, data, work, gaps } = await gather(values, deps, stderr);
  const now = deps.now ?? (() => new Date());
  const publish = config.publish ?? (data.repo.private ? "anonymized" : "full");
  if (publish === "anonymized" && !config.alias) {
    throw new Error(
      `${data.repo.fullName} is published anonymized${config.publish ? "" : " (it is private)"}: set "alias" in ${CONFIG_FILE}, or set "publish"`,
    );
  }
  const dataset = buildDataset(data.repo, work, now(), publish, config.alias, gaps);

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
  await writeSite(local, [dataset]);
  stdout(`${dataset.repo} (publish: none): ${String(dataset.tickets)} tickets, ${String(dataset.pullRequests)} PRs -> ${join(local, "index.html")}\n`);
}

async function doctor(args: string[], deps: Dependencies, stdout: (text: string) => void, stderr: (text: string) => void): Promise<void> {
  const { values } = parseArgs({ args, options: { repo: { type: "string" }, checkout: { type: "string" } } });
  const { data, work, gaps } = await gather(values, deps, stderr);
  stdout(formatDoctor(data.repo.fullName, work.tickets.length, gaps, deviceGaps(deps.claudeDir ?? defaultClaudeDir()), thisDevice(deps.configDir)));
}

async function initCommand(args: string[], deps: Dependencies, stdout: (text: string) => void): Promise<void> {
  const { values } = parseArgs({ args, options: { alias: { type: "string" }, publish: { type: "string" } } });
  const publish = values.publish;
  if (publish !== undefined && publish !== "full" && publish !== "anonymized" && publish !== "none") {
    throw new Error("--publish must be one of full, anonymized, none");
  }
  // The conventions to write are inferred from the repo's history, read as `collect` reads it. With an injected admin and no GitHub source (tests), none is.
  const source = deps.github ?? (deps.admin ? undefined : ghSource({ cwd: deps.cwd }));
  const cacheDir = deps.cacheDir ?? (deps.github ? undefined : defaultCacheDir());
  const inferred = source
    ? inferConventions(await loadGitHub(cacheDir ? cachedSource(source, { dir: cacheDir, now: deps.now ?? (() => new Date()), full: false }) : source), configuredFields(deps.cwd))
    : undefined;
  const lines = await init(deps.cwd, deps.admin ?? ghAdmin(deps.cwd), { alias: values.alias, publish, version: deps.version, inferred });
  stdout(lines.map((line) => `${line}\n`).join(""));
}

const git = promisify(execFile);

/** `owner/name` of the GitHub repo `dir`'s `origin` remote points at; undefined when it is no clone of one. */
async function originRepo(dir: string): Promise<string | undefined> {
  try {
    const { stdout } = await git("git", ["-C", dir, "remote", "get-url", "origin"]);
    return /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(stdout.trim())?.[1];
  } catch {
    return undefined;
  }
}

async function importCommand(args: string[], deps: Dependencies, stdout: (text: string) => void): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      checkout: { type: "string" },
      name: { type: "string", multiple: true, default: [] },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const [source, ...extra] = positionals;
  if (source === undefined || extra.length > 0) throw new Error("import-transcripts takes one folder: the other device's ~/.cache/agentic-metrics or ~/.claude/projects, copied here");
  const checkout = resolve(deps.cwd, values.checkout ?? ".");
  const lines = await importTranscripts({
    source: resolve(deps.cwd, source),
    checkout,
    repo: await (deps.localRepo ?? originRepo)(checkout),
    cacheDir: deps.cacheDir ?? defaultCacheDir(),
    names: values.name,
    dryRun: values["dry-run"],
  });
  stdout(`${lines.join("\n")}\n`);
}

function sameRepo(a: string | undefined, b: string): boolean {
  return a !== undefined && a.toLowerCase() === b.toLowerCase();
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
  // No datasets folder yet (nothing collected): an empty report, not a crash.
  const files = existsSync(datasetsDir) ? (await readdir(datasetsDir, { recursive: true })).filter((file) => file.endsWith(".json")) : [];
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
  await writeSite(out, datasets, caseStudies);
  const summary = datasets.length === 0 ? `no dataset in ${datasetsDir} (run collect first); empty report` : `${String(datasets.length)} datasets`;
  stdout(`${summary} -> ${join(out, "index.html")}\n`);
}
