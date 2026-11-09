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

### Onboarding a repo

`/agentic-metrics:init` (or `npx agentic-metrics init` from the repo root) onboards a repo in one step:

- writes `.agentic-metrics.json` with every field set: ready label `ready-for-agent`, the built-in branch pattern, `integration/` batches, Dependabot excluded, the default autonomy thresholds, and `publish` (`anonymized` for a private repo, else `full`; `--publish` overrides). An anonymized repo gets `--alias name`, or a random alias (`repo-` and 8 hex digits, not derived from the repo's name), which `init` reports so you can change it. `ciWorkflow` is set when exactly one existing workflow runs on pull requests; otherwise `init` says so, and you should set it, since the installed workflow runs on every PR too;
- creates the `regression`, `autonomy:full`, `autonomy:assisted` and `autonomy:manual` labels that are missing;
- installs `.github/workflows/agentic-metrics.yml` (see [GitHub Action](#github-action)), passing the config's ready label and branch pattern, with the Action pinned to a commit SHA;
- reads the repo's Actions permissions and, when only selected actions are allowed and no pattern covers the Action, prints the pattern to add. It never changes those settings.

Re-running is safe: an existing config or workflow is kept as it is, and only missing labels are created. Addenda overrides go in `.agentic-metrics/addenda/` (see above). Review and commit the two files.

## CLI

Run it from a clone of the repo to measure. It reads GitHub through your `gh` login, so there's no token to set up:

```
npx agentic-metrics collect   # writes datasets/<owner>/<repo>.json
npx agentic-metrics report    # renders datasets/ as a site in report/ (open report/index.html)
```

The first `collect` on a repo reads its whole history. Later runs read only the PRs and issues updated since the last run and merge them into a local cache of raw GitHub items, `~/.cache/agentic-metrics/github/<owner>/<repo>/` (or under `$AGENTIC_METRICS_CACHE_DIR`), so the dataset comes out the same as a full re-collection. `collect --full` reads everything again, for example after a metric definition changes. Editing a request's query also triggers a full read of that request on the next run.

`collect --repo owner/name` measures another repo; pass its clone as `--checkout dir` too, so that its config and transcripts are read (without it, `collect` warns that it reads the current folder's config and no transcripts). Per-repo settings live in `.agentic-metrics.json` at the repo root. All fields are optional:

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
- `integrationBranchPrefix` (one string or a list; default `integration/`): PRs from these branches are batches. They count as no ticket and no PR, and are counted apart (`integrationPullRequests` in the dataset). A batch delivers the PRs merged into its branch, and the issues it closes that no PR of their own delivered. Such an issue is credited the batch's commits that name it (`Merge ticket-N: …`, a merged branch `branchRegex` resolves, or `(#N)`) and the commits those merges brought in; autonomy and the diff metrics read them. Commits naming no ticket count for none.
- `exclude`: PRs by these authors (logins; `dependabot` and `dependabot[bot]` both match) or from branches starting with these prefixes count in no metric. Nothing is excluded by default.

Transcript metrics (human messages per ticket, orchestration time) come from the transcripts the plugin caches, for the clone `collect` runs in (with `--repo`, pass that repo's clone as `--checkout dir`, else they are unknown). A session belongs to a ticket through its branch (a ticket PR's head, or the issue number `branchRegex` finds), else its worktree's name, else the PRs it opened; a sub-agent with none of these inherits its parent's ticket. Sessions naming no work are orchestration time. Only counts reach the dataset: no transcript text, account or organisation identifier, session id or path.

Each ticket gets an autonomy level. `full`: a transcript with at most one human message beyond the opening request, and every commit co-authored by Claude (a `Co-Authored-By: Claude …` trailer, or a `Claude-Session:` trailer from a cloud session). `manual`: no transcript and no such commit. `assisted`: anything between. The thresholds are set per repo, and an `autonomy:full`, `autonomy:assisted` or `autonomy:manual` label on the ticket's issue (or, else, its PR) wins; the report counts the tickets so overridden:

```json
{ "autonomy": { "fullMaxFollowUps": 1, "fullMinClaudeCommitShare": 1 } }
```

A regression is an issue labelled `regression` with a line starting `caused-by: #N` in its body or a comment; `#N` is the ticket or PR that caused it. The [GitHub Action](#github-action) adds the label when such a line is written.

CI metrics (first-run CI rate, fix cycles, scheduled failures, batch health) read the repo's GitHub Actions runs. `ciWorkflow` names the main check workflow by path (`.github/workflows/check.yml`), file name or name; unset, it is the workflow that ran on the most PRs. The `agentic-metrics.yml` workflow `init` installs is never CI. A batch drops a PR it names (`#N` in its title or description) that merged only after it.

```json
{ "ciWorkflow": "check.yml" }
```

### Case studies

For a repo published `full`, `collect` flags case-study candidates: the largest ticket (lines changed), the fewest human messages for its size (per line changed), the largest deletion (most lines removed net of lines added) and a regression caught and fixed (a traced regression whose issue was closed as completed). The dataset lists them under `caseStudyCandidates`, and `collect` writes a Markdown draft for each to `case-studies/<owner>/<repo>/<N>.md` (`pr-<N>.md` for a PR that is its own ticket; `--case-studies dir` to change the folder), from the ticket's numbers and its issue and PR descriptions, quoting any PR's "Notable intervention" line. A draft that exists is never overwritten.

A draft starts with `approved: false` in its front matter. Edit it, set `approved: true` and commit it: `report` renders approved case studies only, and never for a repo published `anonymized` or `none` (those get no candidates or drafts either). Drafts themselves are not copied into the report.

### Published report

The tool doesn't host anyone's report. Keep your datasets and case studies in a repo of their own (for example a private `you/agentic-metrics-report`) and render them there:

```
npx agentic-metrics collect --repo owner/name --checkout ~/path/to/name   # writes datasets/owner/name.json
npx agentic-metrics report --datasets datasets --case-studies case-studies --out _site
```

`--checkout` points at the tracked repo's local clone, so its `.agentic-metrics.json` and its Claude Code transcripts are used. Commit `datasets/` (so every published number can be checked against its raw data, which each repo's page links) and the approved case studies, and publish `_site` with any static host. A GitHub Pages workflow for that repo only needs to run the `report` command above with `npx agentic-metrics@0` and deploy `_site`. Every link between pages is relative, so the site works under a sub-path and from `file://`.

The report is a static site of linked pages, each with a sidebar listing them all:

- `index.html`, the overview: the headline tiles pooled over the repos published `full` (each naming the repos it covers and those it is unknown for), a table comparing every repo, every repo's CV-ready sentences, and a card per repo.
- `<owner>--<name>/index.html` (or `<alias>/index.html`), a repo: a number tile per metric with a sparkline of its monthly trend, a grid of charts, the CV-ready sentences with a Copy button, and its approved case studies.
- `<owner>--<name>/<metric-id>.html`, a metric of a repo: its tiles (including its figure at each autonomy level, `full`, `assisted`, `manual`), its chart, its figure by month and by autonomy level, its summary, its per-ticket table (sortable by any column; never for an anonymized repo), its monthly trend as a table, and its definition.
- `<owner>--<name>/case-studies/<N>.html`, an approved case study, titled by its opening heading.
- `methodology.html`: every metric's definition and limits, with its coverage per repo, and links to the raw datasets, copied to `datasets/` beside the pages.

A value that is unknown says so, never 0: a metric over no ticket (or orchestration time with no measured activity) is unknown, and a dataset written before `collect` recorded it so is read the same way. A CV sentence quotes only known values, each with its coverage. Trends and the comparison by autonomy level come from the dataset (`trends`, `byAutonomy`), so an anonymized repo gets them too, from aggregates only, with any figure covering fewer than 3 tickets withheld (shown as —; `"suppressed"` in the dataset).

Adding a metric: write one file in `cli/metrics/` declaring a `Metric` (`cli/metrics/metric.ts` documents each field), then list it in `cli/metrics/index.ts`. The file holds:

- `compute`: its value from the linked work, unknown (never 0) when its source is missing, with its coverage. `anonymize`: the value an anonymized dataset keeps; if the value lists tickets, it must drop them.
- `figure`: one number read off its value, computed again over each month's and each autonomy level's tickets, so it has a trend, a sparkline and a comparison. `byAutonomy: false` for a repo-level figure no ticket owns; `drawNegated` for a figure shown the other way round (net lines changed keeps lines removed, and is drawn as lines changed). A repo-level metric whose coverage is not the tickets it is computed over sets `repoLevel.measured`, so that it stays known over 0 tickets but is unknown when it measured nothing.
- `chart`: its own chart for the repo page's grid and its metric page (`cli/report/charts.ts` has the kinds; `perTicketChart` draws a dot per ticket, falling back to its trend line when an anonymized value keeps no rows).
- `ticketTable`: the rows its value is computed from, on its metric page.
- `section`: its summary in words, on its metric page: what its tiles and table don't say.
- `sentence`: its CV-ready sentence.
- `headline`, for a headline card on the repo page and the overview: `order` among the cards, `card` (its HTML) and `pool`, which pools the known values of the `full` repos into one value for the overview (from per-ticket rows or counts: two medians can't be pooled).
- `methodology`: its definition and limits.

Its tests go in `test/cli/`, fixtures in, dataset and HTML out.

Adding a kind of page: write its renderer in `cli/report/` as a function of a `PageContext` (which turns any site path into a link relative to the page) returning `layout(...)` from `cli/report/shell.ts`, add its path to `PATHS` in `cli/report/site.ts`, list its pages in `renderSite` in `cli/report.ts`, and link it from the sidebar in `shell.ts` if it should be listed there.

Reading something new from GitHub touches these places:

1. `cli/github/source.ts`: add the request's name to `GitHubRequest`, its query (GraphQL text or REST path) and its case in `ghSource`'s `read`. If it lists items that carry an update time, give it an entry in `INCREMENTAL` and it is cached and read incrementally too (a list filtered on something that can change, like a label, can't be: an item leaving the filter would stay in the cache).
2. `cli/github/load.ts`: the raw shape of its answer (`Raw…`), the model type the metrics read (added to `GitHubData`), and the mapping in `loadGitHub`.
3. `test/fixtures/github/`: a recorded `gh api` answer, `<request>.json`, in every folder (`ci`, `empty`, `lifeline`, `private`, and `history/before` and `history/after`), and in the answers built inline by `test/cli/linking.test.ts`.

## GitHub Action

`init` installs it. By hand, add `.github/workflows/agentic-metrics.yml` to a repo:

```yaml
name: agentic-metrics
on:
  pull_request:
    types: [opened, edited, reopened]
  issues:
    types: [opened, edited, labeled]
  issue_comment:
    types: [created]
permissions:
  contents: read
  pull-requests: write
  issues: write
jobs:
  conventions:
    runs-on: ubuntu-latest
    steps:
      - uses: grimfeld/agentic-metrics/action@<full commit SHA> # <ref>
        # with:
        #   branch-regex: '^spec[-/](\d+)'
        #   bug-label: bug
        #   ready-label: ready-for-agent
```

**SHA pinning.** `init` pins the Action to a full commit SHA, with the ref it resolved in a trailing comment: the release tag of the CLI's version (`v0.2.0`) when `grimfeld/agentic-metrics` has that tag, else `main`. A repo whose Actions settings require SHA pinning (`sha_pinning_required`) rejects `@main` or `@v0.2.0` with a `startup_failure`, and a pinned SHA can't move under you anyway. By hand, look the commit up with `gh api repos/grimfeld/agentic-metrics/commits/main --jq .sha`. To upgrade, replace the SHA and the comment (or delete the workflow and run `init` again). When the repo requires pinning and an existing workflow isn't pinned, `init` says so.

**Allow-listing.** A repo (or its organisation) that allows only selected actions must allow this one too, else its runs end in `startup_failure`. `init` reads the repo's settings (`gh api repos/<owner>/<repo>/actions/permissions` and `…/selected-actions`) and, when no allowed pattern covers the Action, prints the pattern to add:

```
grimfeld/agentic-metrics/action@*
```

Add it under Settings > Actions > General > Actions permissions > Allow specified actions and reusable workflows (for an organisation's repo, possibly in the organisation's settings). `init` never edits these settings; reading them needs admin rights on the repo, and without them `init` names the pattern to check and goes on.

When a PR's description references no issue and its branch name carries one (`spec-376-…`, `spec/363-…`, `ticket-16`, `16-title`), the Action appends `Closes #N`. A description that already mentions an issue (`#12`, `owner/repo#12`, an issue link) is left alone, and so are PRs from forks. It needs only the default workflow token. `branch-regex` overrides the built-in pattern; the number is its first capture group that matched.

When an issue's description (on opening or editing) or a new comment has a line starting `caused-by: #N`, the Action adds the `regression` label, which `collect` needs to count the regression. `owner/repo#N` is not accepted: work in another repo can't be traced. When an issue gets the bug label (`bug-label`, default `bug`), the Action asks "Regression? Reply `caused-by: #N`", unless the issue already carries a `caused-by: #N` line. When a ticket gets the ready label (`ready-label`, default `ready-for-agent`) and no comment starts with `estimate: <n><h|d|w>`, it posts a one-line estimate reminder. Each reminder carries a hidden marker and is posted at most once per issue, however often the label is removed and added again.

## Repository layout

- `plugin/`: the Claude Code plugin (manifest, hooks, `addenda/`, `skills/`). `.claude-plugin/marketplace.json` at the root points at it.
- `action/`: the GitHub Action (`action.yml`; `decide.ts` is the pure decision function, `main.ts` the wrapper that calls GitHub).
- `test/`: tests, one folder per deliverable, with fixtures under `test/fixtures/`.
- `cli/`: the CLI. `cli/metrics/` holds one file per metric; `cli/report/` the report site (`site.ts` the site map, `shell.ts` the shared page layout and sidebar, a renderer per kind of page, `charts.ts` the inline SVG charts). `npm run build` emits it as JavaScript into `dist/` for the npm package, because Node doesn't strip types under `node_modules`. `npm pack` runs the build.

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
