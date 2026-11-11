---
name: enrich
description: Propose the agentic-metrics conventions a ticket is missing - its kind:* label, the caused-by line of a fix whose regression tracing found a cause, the Closes line of a PR linked to no issue - and write only those the person accepts. Use when the user runs /agentic-metrics:enrich #N, or asks to fill in a ticket's missing metrics conventions.
---

# Enrich one ticket

You propose; the person decides; only what they accept is written, as the ordinary conventions (docs/adr/0002 in grimfeld/agentic-metrics). Never store a conclusion anywhere else, and never write without their acceptance.

One ticket per run. Never apply anything to several tickets without asking for each.

## 1. Read what is known

From the repo's clone, run:

```
npx agentic-metrics enrich-context <N>
```

It prints JSON: the ticket, its issue and PRs, its current `kind`, whether it is a `bugFix`, the `declaredCauses` already written, the `candidates` that reverts and blame found its fix regressed, and its `unlinkedPullRequests`.

Then read the ticket itself: `gh issue view <issue>` and `gh pr view <pr> --json title,body,files` for each of its PRs, and the diff (`gh pr diff <pr>`) if the title and description don't make the change clear.

## 2. Propose only what is missing

- **Kind of change**, when `kind` is `unknown`: one of `feature`, `fix`, `refactor`, `chore`, `docs`, `test`, judged from what the PRs changed, not from wording alone. A ticket that only moves or renames code is a `refactor`; one that only touches tests, `test`; dependencies and tooling, `chore`. When `kind` is `conflicting`, say so and propose the one that fits.
- **Cause**, when `bugFix` is true, `declaredCauses` is empty and the ticket has an issue: pick among `candidates` the one whose change the fix actually corrects, reading its diff, or say none fits. Never name a ticket that is not a candidate: the tool refuses it.
- **Issue link**, for each of `unlinkedPullRequests`: find the issue it delivers (`gh issue list --search "<words from the PR title>" --state all`), or say none.

Propose nothing for a convention already set.

## 3. Ask once, then write what was accepted

Show every proposal for this ticket together, each with a one-line reason, and ask which to apply (the AskUserQuestion tool, multi-select). Then run, with only the accepted ones:

```
npx agentic-metrics enrich-apply <N> [--kind <kind>] [--caused-by <M>] [--closes <PR>:<issue>]
```

With nothing accepted, run nothing. Report what it wrote.
