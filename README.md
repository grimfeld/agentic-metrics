# agentic-metrics
Measure an agentic engineering workflow from GitHub and Claude Code transcripts: lead time, first-pass CI, autonomy, cost, regressions.

## Claude Code plugin

This repo is also the plugin's marketplace. Install it once and it covers every repo you work in:

```
/plugin marketplace add grimfeld/agentic-metrics
/plugin install agentic-metrics@agentic-metrics
```

It needs Node 24 or later on your `PATH`.

At the end of every session the plugin copies the session's full transcript, and its sub-agent transcripts, into `~/.cache/agentic-metrics/<project>/` so they survive Claude Code's cleanup. Set `AGENTIC_METRICS_CACHE_DIR` to use another folder. The hook only copies files: it makes no network calls and never fails the session end.

### Skill addenda

Addenda add the metrics conventions to third-party skills without forking them. When a skill loads, whether Claude invokes it or you type `/name`, the plugin adds that skill's addendum to the context. The plugin's own `agentic-metrics:conventions` skill documents the conventions.

| Skill | Addendum |
| --- | --- |
| `pr` | ends the PR description with a "Notable intervention" line when the human stepped in |
| `diagnosing-bugs` | replies `caused-by: #N` on the bug once the cause is found |
| `implement-spec` | doesn't block on a missing estimate |

A repo overrides one by name: `.agentic-metrics/addenda/<skill>.md` at its root replaces the shipped addendum, adds one for a skill that has none, or, left empty, switches it off. A namespaced skill (`plugin:name`) matches on its full name first, then on `name`.

## CLI

Run it from a clone of the repo to measure. It reads GitHub through your `gh` login, so there's no token to set up:

```
npx agentic-metrics collect   # writes datasets/<owner>/<repo>.json
npx agentic-metrics report    # renders datasets/ as report/index.html
```

The first `collect` on a repo reads its whole history. Later runs read only the PRs and issues updated since the last run and merge them into a local cache of raw GitHub items, `~/.cache/agentic-metrics/github/<owner>/<repo>/` (or under `$AGENTIC_METRICS_CACHE_DIR`), so the dataset comes out the same as a full re-collection. `collect --full` reads everything again, for example after a metric definition changes. Editing a request's query also triggers a full read of that request on the next run.

`collect --repo owner/name` measures another repo. Per-repo settings live in `.agentic-metrics.json` at the repo root. All fields are optional:

```json
{ "readyLabel": "ready-for-agent", "publish": "anonymized", "alias": "client-a" }
```

`publish` sets what a repo's dataset may show:

- `full`: titles and links of every delivered ticket. The default for a public repo.
- `anonymized`: aggregates only, written to `datasets/<alias>.json` under `alias`, with no names, titles, ticket numbers or links. The default for a private repo; `collect` refuses to run without an `alias`.
- `none`: nothing in the datasets; a local report in `.agentic-metrics-local/index.html` (`--local dir` to change).

Linking PRs to tickets. A merged PR is linked to an issue by the first of: its closing references (`Closes #N`), the issue number in its branch name, `(#N)` in its commit subjects. A PR linked to no issue is a ticket of its own. These fields tune it:

```json
{
  "branchRegex": "^spec[-/](\\d+)",
  "integrationBranchPrefix": ["integration/", "batch/"],
  "exclude": { "authors": ["dependabot"], "branches": ["dependabot/"] }
}
```

- `branchRegex`: a case-insensitive JavaScript pattern; the issue number is its first capture group that matched. The default is the GitHub Action's built-in pattern (`16-title`, `spec-376-…`, `spec/363-…`, `ticket-16`, `fix/issue-12`), defined once in `cli/branch.ts`.
- `integrationBranchPrefix` (one string or a list; default `integration/`): PRs from these branches are batches. They count as no ticket and no PR, and are counted apart (`integrationPullRequests` in the dataset). A batch delivers the PRs merged into its branch, and the issues it closes that no PR of their own delivered.
- `exclude`: PRs by these authors (logins; `dependabot` and `dependabot[bot]` both match) or from branches starting with these prefixes count in no metric. Nothing is excluded by default.

Transcript metrics (human messages per ticket, orchestration time) come from the transcripts the plugin caches, for the clone `collect` runs in (with `--repo`, pass that repo's clone as `--checkout dir`, else they are unknown). A session belongs to a ticket through its branch (a ticket PR's head, or the issue number `branchRegex` finds), else its worktree's name, else the PRs it opened; a sub-agent with none of these inherits its parent's ticket. Sessions naming no work are orchestration time. Only counts reach the dataset: no transcript text, account or organisation identifier, session id or path.

Each ticket gets an autonomy level. `full`: a transcript with at most one human message beyond the opening request, and every commit co-authored by Claude (a `Co-Authored-By: Claude …` trailer, or a `Claude-Session:` trailer from a cloud session). `manual`: no transcript and no such commit. `assisted`: anything between. The thresholds are set per repo, and an `autonomy:full`, `autonomy:assisted` or `autonomy:manual` label on the ticket's issue (or, else, its PR) wins; the report counts the tickets so overridden:

```json
{ "autonomy": { "fullMaxFollowUps": 1, "fullMinClaudeCommitShare": 1 } }
```

A regression is an issue labelled `regression` with a line starting `caused-by: #N` in its body or a comment; `#N` is the ticket or PR that caused it.

CI metrics (first-run CI rate, fix cycles, scheduled failures, batch health) read the repo's GitHub Actions runs. `ciWorkflow` names the main check workflow by path (`.github/workflows/check.yml`), file name or name; unset, it is the workflow that ran on the most PRs. A batch drops a PR it names (`#N` in its title or description) that merged only after it.

```json
{ "ciWorkflow": "check.yml" }
```

### Case studies

For a repo published `full`, `collect` flags case-study candidates: the largest ticket (lines changed), the fewest human messages for its size (per line changed), the largest deletion (most lines removed net of lines added) and a regression caught and fixed (a traced regression whose issue was closed as completed). The dataset lists them under `caseStudyCandidates`, and `collect` writes a Markdown draft for each to `case-studies/<owner>/<repo>/<N>.md` (`pr-<N>.md` for a PR that is its own ticket; `--case-studies dir` to change the folder), from the ticket's numbers and its issue and PR descriptions, quoting any PR's "Notable intervention" line. A draft that exists is never overwritten.

A draft starts with `approved: false` in its front matter. Edit it, set `approved: true` and commit it: `report` renders approved case studies only, and never for a repo published `anonymized` or `none` (those get no candidates or drafts either). Drafts themselves are not copied into the report.

### Published report

This repo publishes the report for every tracked repo on its GitHub Pages. Datasets are committed under `datasets/<owner>/<repo>.json`, so every published number can be checked against its raw data, which each repo's section links. To track a repo, run `collect` from this repo and commit the dataset:

```
npx agentic-metrics collect --repo owner/name   # writes datasets/owner/name.json
```

`.github/workflows/pages.yml` renders `datasets/` and deploys it on every push to `main` that touches `datasets/` or `cli/`, or by hand from the Actions tab. One-time setting: Settings > Pages > Build and deployment > Source: **GitHub Actions**.

Adding a metric: write one file in `cli/metrics/` holding its computation (its dataset field), how the report shows it, and its Methodology entry. Then list it in `cli/metrics/index.ts`. Its tests go in `test/cli/`, fixtures in, dataset and HTML out. To read something new from GitHub, add a request to `cli/github/source.ts` and a recorded `gh api` answer to each folder in `test/fixtures/github/`. If the request lists items that carry an update time, give it an entry in `INCREMENTAL` in the same file and it is cached and read incrementally too (a list filtered on something that can change, like a label, can't be: an item leaving the filter would stay in the cache).

## GitHub Action

Add `.github/workflows/agentic-metrics.yml` to a repo:

```yaml
name: agentic-metrics
on:
  pull_request:
    types: [opened, edited, reopened]
  issues:
    types: [labeled]
permissions:
  contents: read
  pull-requests: write
  issues: write
jobs:
  conventions:
    runs-on: ubuntu-latest
    steps:
      - uses: grimfeld/agentic-metrics/action@main
        # with:
        #   branch-regex: '^spec[-/](\d+)'
        #   bug-label: bug
        #   ready-label: ready-for-agent
```

When a PR's description references no issue and its branch name carries one (`spec-376-…`, `spec/363-…`, `ticket-16`, `16-title`), the Action appends `Closes #N`. A description that already mentions an issue (`#12`, `owner/repo#12`, an issue link) is left alone, and so are PRs from forks. It needs only the default workflow token. `branch-regex` overrides the built-in pattern; the number is its first capture group that matched.

When an issue gets the bug label (`bug-label`, default `bug`), the Action asks "Regression? Reply `caused-by: #N`", unless the issue already carries a `caused-by: #N` line. When a ticket gets the ready label (`ready-label`, default `ready-for-agent`) and no comment starts with `estimate: <n><h|d|w>`, it posts a one-line estimate reminder. Each reminder carries a hidden marker and is posted at most once per issue, however often the label is removed and added again.

## Repository layout

- `plugin/`: the Claude Code plugin (manifest, hooks, `addenda/`, `skills/`). `.claude-plugin/marketplace.json` at the root points at it.
- `action/`: the GitHub Action (`action.yml`; `decide.ts` is the pure decision function, `main.ts` the wrapper that calls GitHub).
- `test/`: tests, one folder per deliverable, with fixtures under `test/fixtures/`.
- `cli/`: the CLI. `npm run build` emits it as JavaScript into `dist/` for the npm package, because Node doesn't strip types under `node_modules`. `npm pack` runs the build.

TypeScript runs directly on Node 24 (type stripping), so source files use erasable syntax only and there is no build step for the plugin or the Action (its `runs.main` is `main.ts`, run by the runner's Node 24); `tsc` type-checks.

## Contributing

Use Node 24 (`.nvmrc`) and npm. CI runs exactly these, in order:

```
npm ci
npm run lint        # eslint .
npm run typecheck   # tsc
npm test            # node --test "test/**/*.test.ts"
npm run build       # tsc -p tsconfig.build.json (the CLI, into dist/)
```

`npm run check` runs lint, typecheck and tests in one go.
