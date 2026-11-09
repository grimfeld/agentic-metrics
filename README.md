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

## Repository layout

- `plugin/`: the Claude Code plugin (manifest, hooks, `addenda/`, `skills/`). `.claude-plugin/marketplace.json` at the root points at it.
- `test/`: tests, one folder per deliverable, with fixtures under `test/fixtures/`.
- The CLI and the GitHub Action will get their own top-level folders.

TypeScript runs directly on Node 24 (type stripping), so source files use erasable syntax only and there is no build step for the plugin; `tsc` type-checks.

## Contributing

Use Node 24 (`.nvmrc`) and npm. CI runs exactly these, in order:

```
npm ci
npm run lint        # eslint .
npm run typecheck   # tsc
npm test            # node --test "test/**/*.test.ts"
```

`npm run check` runs lint, typecheck and tests in one go.
