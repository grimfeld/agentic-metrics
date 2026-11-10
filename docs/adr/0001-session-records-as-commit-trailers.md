---
status: accepted
---

# Session records travel as commit trailers, written by hooks `init` commits to each repo

Human messages and session timings used to exist only in transcripts cached on the device a session ran on, so work done on another device or in a cloud container had none (0 of 94 tickets on one repo, 17% on another). We decided that each session leaves a session record (counts only: active time, human messages, sub-agents spawned, under an opaque session key) as trailers on the commits it makes, and that the recorder is a hook and script `init` commits into the measured repo's `.claude/settings.json`, not part of the plugin.

## Considered options

- **The plugin's hooks.** Rejected: Claude Code cloud sessions load no plugin, neither user-level nor declared by the repo, but they do run hooks from a committed `.claude/settings.json`.
- **A PR comment or description block.** Rejected: it needs the network at the end of a session, where the session-end hook has 1.5 s and a cloud container's network may be closed, and it records nothing for work that has no PR.
- **A committed file per session.** Rejected: it adds noise to every diff and conflicts between parallel branches.
- **Reading the transcript when committing.** Rejected: the transcript is written asynchronously and can lack the current turn, so the recorder keeps its own counters in an uncommitted state file.
- **A git `commit-msg` hook to add the trailers.** Rejected: it needs `core.hooksPath`, which collides with Husky and must be set in every fresh clone. The recorder rewrites the agent's `git commit` command instead, without granting it permission; the prototype below showed that this works.

## What the prototype showed

Observed on 2026-11-10 in a Claude Code cloud session (Claude Code 2.1.322, permission mode `auto`, git 2.43), with hooks in the repo's `.claude/settings.json`:

- **The rewrite works with no permission decision.** A `PreToolUse` hook on `Bash` that returned `updatedInput` with ` --trailer "…"` added after `git commit`, and no `permissionDecision`, had its command run as rewritten, for the main session and for a sub-agent. The hook grants nothing: the rewritten command goes through the session's own permission flow.
- **Hooks tell a sub-agent from its parent.** A sub-agent's tool events carry `agent_id` and `agent_type` beside the parent's `session_id`; the main session's carry neither.
- **A merge commit can carry the record.** `git merge` has no `--trailer`, but a second `-m` becomes a paragraph of its own, which git reads as trailers. This only holds when the merge already has a message: adding `-m` to one that has none would replace git's default message.
- **The prompt hook also fires on text no person typed.** `UserPromptSubmit` fired for a sub-agent's hand-back (`<agent-message …>`). The recorder counts a prompt as a human message only when it does not start with `<`, `/` or `!`.
- **Hooks added to `.claude/settings.json` mid-session took effect at once**, which is what made the prototype possible in one session.

Not tested: the other permission modes (`default`, `acceptEdits`, `plan`), where a rewritten command may be shown to the person for approval; a local, non-cloud session; and Claude Code versions other than the one above.

## Consequences

- A session's activity after its last commit is not recorded, and a session that never commits leaves nothing. Where a transcript is cached it is preferred, since it covers that tail.
- The record is public wherever the repo's history is. It never holds message text.
- Each repo carries its own copy of the recorder: upgrading it means running `init` again in that repo.
- The recorder's human message count can differ slightly from a transcript's, which tells slash commands and interrupts apart more precisely.
- The human messages of a session that orchestrates sub-agents stay orchestration: they are recorded on that session's own commits and are not split across the tickets its sub-agents delivered.
- One session can work on several tickets, so its record is not a per-ticket figure. Counters are cumulative, and what a commit adds is the difference from the same session's previous commit: that difference belongs to the ticket whose commit carries it.
