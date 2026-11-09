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

Adding a metric: write one file in `cli/metrics/` holding its computation (its dataset field), how the report shows it, and its Methodology entry. Then list it in `cli/metrics/index.ts`. Its tests go in `test/cli/`, fixtures in, dataset and HTML out. To read something new from GitHub, add a request to `cli/github/source.ts` and a recorded `gh api` answer to each folder in `test/fixtures/github/`.

## Repository layout

- `plugin/`: the Claude Code plugin (manifest, hooks). `.claude-plugin/marketplace.json` at the root points at it.
- `test/`: tests, one folder per deliverable, with fixtures under `test/fixtures/`.
- `cli/`: the CLI. `npm run build` emits it as JavaScript into `dist/` for the npm package, because Node doesn't strip types under `node_modules`. `npm pack` runs the build.
- The GitHub Action will get its own top-level folder.

TypeScript runs directly on Node 24 (type stripping), so source files use erasable syntax only and there is no build step for the plugin; `tsc` type-checks.

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
