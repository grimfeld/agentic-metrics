---
description: Onboard the current repo to agentic-metrics (config, labels, GitHub Action workflow)
argument-hint: "[--alias name] [--publish full|anonymized|none]"
allowed-tools: Bash(npx agentic-metrics init:*)
---

Onboard this repo to agentic-metrics. From the repo root, run:

```
npx agentic-metrics init $ARGUMENTS
```

It writes `.agentic-metrics.json`, creates the `regression` and `autonomy:*` labels through `gh`, and installs `.github/workflows/agentic-metrics.yml`. An existing config or workflow is kept, so it is safe to run again.

Report what it printed. If it picked a random alias for a private repo, say so and suggest editing `alias` in the config to a name of the user's choosing. If it printed an allow-list pattern to add, pass it on with where to add it; do not change the repo's Actions settings yourself. Remind the user to review and commit the two files; do not commit them yourself.
