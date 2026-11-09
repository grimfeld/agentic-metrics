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

`collect --repo owner/name` measures another repo. Per-repo settings live in `.agentic-metrics.json` at the repo root. All fields are optional:

```json
{ "readyLabel": "ready-for-agent" }
```

### Published report

This repo publishes the report for every tracked repo on its GitHub Pages. Datasets are committed under `datasets/<owner>/<repo>.json`, so every published number can be checked against its raw data, which each repo's section links. To track a repo, run `collect` from this repo and commit the dataset:

```
npx agentic-metrics collect --repo owner/name   # writes datasets/owner/name.json
```

`.github/workflows/pages.yml` renders `datasets/` and deploys it on every push to `main` that touches `datasets/` or `cli/`, or by hand from the Actions tab. One-time setting: Settings > Pages > Build and deployment > Source: **GitHub Actions**.

Adding a metric: write one file in `cli/metrics/` holding its computation (its dataset field), how the report shows it, and its Methodology entry. Then list it in `cli/metrics/index.ts`. Its tests go in `test/cli/`, fixtures in, dataset and HTML out. To read something new from GitHub, add a request to `cli/github/source.ts` and a recorded `gh api` answer to each folder in `test/fixtures/github/`.

## GitHub Action

Add `.github/workflows/agentic-metrics.yml` to a repo:

```yaml
name: agentic-metrics
on:
  pull_request:
    types: [opened, edited, reopened]
permissions:
  contents: read
  pull-requests: write
jobs:
  conventions:
    runs-on: ubuntu-latest
    steps:
      - uses: grimfeld/agentic-metrics/action@main
        # with:
        #   branch-regex: '^spec[-/](\d+)'
```

When a PR's description references no issue and its branch name carries one (`spec-376-…`, `spec/363-…`, `ticket-16`, `16-title`), the Action appends `Closes #N`. A description that already mentions an issue (`#12`, `owner/repo#12`, an issue link) is left alone, and so are PRs from forks. It needs only the default workflow token. `branch-regex` overrides the built-in pattern; the number is its first capture group that matched.

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
