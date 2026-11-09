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

- `plugin/`: the Claude Code plugin (manifest, hooks). `.claude-plugin/marketplace.json` at the root points at it.
- `action/`: the GitHub Action (`action.yml`; `decide.ts` is the pure decision function, `main.ts` the wrapper that calls GitHub).
- `test/`: tests, one folder per deliverable, with fixtures under `test/fixtures/`.
- The CLI will get its own top-level folder.

TypeScript runs directly on Node 24 (type stripping), so source files use erasable syntax only and there is no build step for the plugin or the Action (its `runs.main` is `main.ts`, run by the runner's Node 24); `tsc` type-checks.

## Contributing

Use Node 24 (`.nvmrc`) and npm. CI runs exactly these, in order:

```
npm ci
npm run lint        # eslint .
npm run typecheck   # tsc
npm test            # node --test "test/**/*.test.ts"
```

`npm run check` runs lint, typecheck and tests in one go.
