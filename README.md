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
- installs the recorder: `.agentic-metrics/recorder.mjs` and its hook entries in `.claude/settings.json`, beside whatever that file already holds (see [Session records](#session-records)).

Re-running is safe: an existing config or workflow is kept as it is, only missing labels are created, and the recorder script is replaced only when this version's differs. Addenda overrides go in `.agentic-metrics/addenda/` (see above). Review and commit the files it wrote.

### Session records

Transcripts stay on the device a session ran on, so work done on another machine, or in a Claude Code cloud session, has none. The recorder makes a session's counts travel with the repo instead: each commit a session makes carries a **session record** as a trailer.

```
Session-Record: v1 k=3fa9c1d2e4b7 active=754 human=3 agents=2 started=2026-11-10T18:00:00Z
```

- `k`: an opaque key for the session (a hash; a sub-agent has its own, and names its parent's as `parent=`).
- `active`: seconds the session has been active so far: the gaps between its prompts and tool calls, each capped at 5 minutes.
- `human`: the prompts a person typed so far. Slash commands, shell escapes and text written by the tooling or another agent don't count.
- `agents`: the sub-agents it has spawned so far.
- `started`: when it began.

Counts only: no session id, path or text. The record is public wherever the repo's history is.

The recorder is one script, `.agentic-metrics/recorder.mjs`, run by hooks in the repo's committed `.claude/settings.json` (on each prompt, each tool call, and at the end of a turn). It lives in the repo, not in the plugin, because a cloud session loads no plugin but does run the repo's own hooks. It needs Node 18 or later and git 2.32 or later, keeps its counters in `.git/agentic-metrics/` (never committed), and adds the trailer by rewriting the agent's `git commit` command, and `git merge` when it has a message. It grants no permission: the rewritten command goes through the session's usual permission flow. On any error it does nothing, so it never blocks a prompt, a tool call or a commit. A commit you type yourself in a terminal carries no record.

To upgrade the recorder, run `init` again in the repo and commit the changed script. To remove it, delete the script and its entries from `.claude/settings.json`.

`collect` reads the records from the commits it already loads, so nothing changes in how you run it. A session's counters are cumulative and one session can work on several tickets, so what a commit adds is the difference from that session's previous commit, and it goes to the ticket the commit belongs to. What a merge commit adds, or a commit of no ticket, is orchestration. Human messages per ticket, autonomy, sub-agents per ticket, orchestration time, active time and lead time's phases all read records as they read transcripts; API-equivalent cost does not (a record has no token counts), so a ticket known only through records has an unknown cost.

Limits: what a session does after its last commit is not recorded, and a session that never commits leaves nothing. Where a transcript is cached for the same session, `collect` reads the transcript and ignores its records. A sub-agent known only through records has no model. Squashing commits before the PR is opened keeps the records (the trailers are in the squashed message), but a squash that rewrites the message by hand can drop them.

### Working on several devices

A repo worked on from a laptop, a desktop and cloud sessions leaves its traces in three places. This is how to get all of them into one report.

**From now on: commit the recorder.** In each measured repo, once:

1. Run `npx agentic-metrics init` (or `/agentic-metrics:init`) in a clone of the repo.
2. Commit `.agentic-metrics/recorder.mjs` and `.claude/settings.json`, and push. If `init` warns that git ignores either file, un-ignore it first.
3. On every other device, pull. A cloud session gets the files with its clone.

From then on every session, on any device or in the cloud, leaves a [session record](#session-records) on its commits, and `collect` reads it from GitHub wherever you run it. Nothing needs copying between devices. To check it works, make a commit from a Claude Code session and look for a `Session-Record:` trailer in `git log -1`.

**For past work: import each device's transcripts.** A session that ran before the recorder was installed is only known through its transcript, which stays on the device it ran on:

| Where the session ran | What is left of it | Where |
| --- | --- | --- |
| A device with the plugin installed | Its full transcript, kept for good | `~/.cache/agentic-metrics/` on that device |
| A device without the plugin | Its transcript, until Claude Code's cleanup removes it (after 30 days by default, the `cleanupPeriodDays` setting) | `~/.claude/projects/` on that device |
| A cloud session | Nothing: the transcript went with its container | Its commits only |

Pick one device to run `collect` on, and for each other device:

1. Copy that device's `~/.cache/agentic-metrics` folder (or, without the plugin, its `~/.claude/projects` folder) to the collecting device, anywhere, for example `~/from-laptop`. Copy `~/.claude/projects` soon: it empties itself.
2. On the collecting device, from the repo's clone, see what would be imported, then import it:

   ```
   npx agentic-metrics import-transcripts ~/from-laptop --dry-run
   npx agentic-metrics import-transcripts ~/from-laptop
   ```

   It finds the project folders named after the clone and copies them into this device's cache under the local clone's name, worktrees and sub-agents included. Claude Code names a transcript folder after the clone's path, which differs between devices; that is why a plain copy is not enough. If the clone's folder is called something else on the other device, pass it: `--name life`. From outside the clone, add `--checkout ~/path/to/clone`.
3. Repeat for each repo (run it from each repo's clone) and each device. Importing twice is safe: a transcript already there is kept, unless the imported one is longer.
4. Run `collect` again for each repo.

A ticket with neither a transcript nor a session record still gets what commits alone give: lead time with its phases, and an estimated active time. Its human messages, cost and sub-agents stay unknown.

## CLI

Run it from a clone of the repo to measure. It reads GitHub through your `gh` login, so there's no token to set up:

```
npx agentic-metrics collect   # writes datasets/<owner>/<repo>.json
npx agentic-metrics report    # renders datasets/ as a site in report/ (open report/index.html)
```

`import-transcripts` brings another device's transcripts into this one's cache; see [Working on several devices](#working-on-several-devices).

`collect` also writes the repo's **gaps** to the dataset (`gaps`): data a metric needs that is missing, with the reason it is missing. Each gap names the metrics it leaves unknown or partial, the tickets it affects (repo-level gaps affect none in particular), and one fix: a command to run, a change to `.agentic-metrics.json`, a convention to follow from now on, a GitHub setting, or why it can't be fixed. It finds tickets with neither a transcript nor a session record, or known only through records (no cost); the recorder missing or not committed; the Action missing, not committed, or blocked by the repo's allowed actions; tickets never labelled ready; no regression ever declared; and a main CI workflow that was guessed, configured but never run, or absent. An anonymized dataset keeps each gap's counts and no ticket number.

`npx agentic-metrics doctor` (with `--repo` and `--checkout` as `collect` takes them) prints those gaps, repo-level ones first and then by tickets affected, each with its fix, followed by this device's own: whether the plugin caches its transcripts and, if not, how long Claude Code keeps them (`cleanupPeriodDays`). It reads the repo as `collect` does and changes nothing: no dataset, no file in the repo, nothing on GitHub or in `~/.claude`.

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

How long a ticket took. Two figures answer it, defined in `GLOSSARY.md`:

- **Active time**, the headline: how long the ticket was actually worked on, with the idle left out. It is *measured* from the ticket's Claude Code sessions when their transcripts are cached (the gaps between a session's lines, each capped at 5 minutes; a stretch several sessions or sub-agents ran in counts once). For a ticket with no transcript it is *estimated* from its commits (the gaps between consecutive commits, each capped at 30 minutes), and unknown when the ticket has a single commit. The two are separate metrics, `activeTime` and `estimatedActiveTime`, over different tickets, and are never pooled together.
- **Lead time**: calendar time from the ticket becoming ready to its delivery, idle included. It is split into three phases that add up to it: *queue* (ready to the first activity), *work* (first to last activity) and *landing wait* (last activity to delivery, the wait for a batch to land included). Activity is the ticket's own commits, merges left out, and the lines of its sessions.

Transcript metrics (human messages per ticket, orchestration time, measured active time) come from the transcripts the plugin caches, and, for sessions with no cached transcript, from the [session records](#session-records) on their commits. Transcripts are read for the clone `collect` runs in (with `--repo`, pass that repo's clone as `--checkout dir`, else they are unknown). A session belongs to a ticket through its branch (a ticket PR's head, or the issue number `branchRegex` finds), else its worktree's name, else the PRs it opened; a sub-agent with none of these inherits its parent's ticket. Sessions naming no work are orchestration time. Only counts reach the dataset: no transcript text, account or organisation identifier, session id or path.

Each ticket gets an autonomy level. `full`: a transcript, or session records, with at most one human message beyond the opening request, and every commit co-authored by Claude (a `Co-Authored-By: Claude …` trailer, or a `Claude-Session:` trailer from a cloud session). `manual`: no transcript, no session record and no such commit. `assisted`: anything between. The thresholds are set per repo, and an `autonomy:full`, `autonomy:assisted` or `autonomy:manual` label on the ticket's issue (or, else, its PR) wins; the report counts the tickets so overridden:

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

When an issue's description (on opening or editing) or a new comment has a line starting `caused-by: #N`, the Action adds the `regression` label, which `collect` needs to count the regression. `owner/repo#N` is not accepted: work in another repo can't be traced. When an issue gets the bug label (`bug-label`, default `bug`), the Action asks "Regression? Reply `caused-by: #N`", unless the issue already carries a `caused-by: #N` line. When a ticket gets the ready label (`ready-label`, default `ready-for-agent`) and no comment starts with `estimate: <n><h|d|w>`, it posts a one-line estimate reminder. An estimate is of working time (a day is 8 h, a week 5 days), and is compared with the ticket's active time. Each reminder carries a hidden marker and is posted at most once per issue, however often the label is removed and added again.

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
