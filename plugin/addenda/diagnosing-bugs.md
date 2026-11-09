agentic-metrics addendum to the bug-diagnosis skill (convention: agentic-metrics:conventions).

Once the cause of a bug tracked in a GitHub issue is found, and that cause was introduced by an earlier ticket or PR, the bug issue gets a reply on a line of its own:

caused-by: #N

#N is the ticket (issue) or PR that introduced the cause; a PR is fine when the ticket is unclear. One way to post it: `gh issue comment <bug> --body "caused-by: #N"`. The bug also gets the `regression` label when the repo has it. When the cause predates any ticket, or the bug is not a regression, no reply is posted. The metrics count regressions per ticket from these replies.
