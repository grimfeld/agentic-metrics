---
name: conventions
description: The agentic-metrics conventions for tickets, bugs and PRs - `estimate:` comments, `caused-by:` replies, `autonomy:*` labels and the "Notable intervention" PR line. Use when writing an estimate, tracing a bug to the ticket that caused it, correcting a ticket's autonomy level, or writing a PR description in a repo measured by agentic-metrics.
---

# agentic-metrics conventions

agentic-metrics derives almost everything from GitHub and Claude Code transcripts. These four conventions are the only manual inputs. All are optional; where one is missing the report says unknown rather than guessing.

## `estimate:` on a ticket

An issue comment on a line of its own:

```
estimate: 2d
```

- Format: a number followed by `h` (hours), `d` (days) or `w` (weeks).
- It is an estimate of working time, not of calendar time: a day is 8 hours and a week 5 days. It is compared with the ticket's active time, the time it was actually worked on, not with how long it took to be delivered.
- Only the earliest matching comment counts. Later comments do not revise it.
- It counts only if it was posted before the first commit of any of the ticket's PRs. An estimate written after work starts is ignored.
- Never block on a missing estimate, and never add one on the human's behalf.

## `caused-by:` on a bug

When a bug turns out to be a regression, reply on the bug issue (or put the line in its body):

```
caused-by: #N
```

- `#N` is the ticket or PR that introduced the cause. A PR is resolved to its ticket.
- The bug also needs the `regression` label: the agentic-metrics Action adds it when the line is posted; add it by hand in a repo without the Action.
- Post it as soon as the cause is found. No reply when the bug is not a regression.

## `autonomy:*` label on a ticket

Each ticket's autonomy level is computed from human messages in the transcripts and Claude co-author trailers:

- `full`: at most one human message beyond the opening request, and every commit co-authored by Claude.
- `assisted`: Claude co-authored commits with more human messages, or some human-only commits.
- `manual`: no transcript and no co-author trailer.

To correct a misclassification, put `autonomy:full`, `autonomy:assisted` or `autonomy:manual` on the ticket. The label wins over the computed level. The report shows how many tickets were overridden.

## "Notable intervention" in a PR

When the human stepped in (corrected a direction, fixed something by hand, unblocked an agent), the PR description ends with one line:

```
Notable intervention: <one sentence on what the human did and why>
```

Leave the line out when nobody stepped in; never write "none". Case studies quote it.

## Linking PRs to tickets

A PR is linked to its ticket by `Closes #N` in its description, else the issue number in its branch name, else `(#N)` in its commit subjects. Prefer `Closes #N`.
