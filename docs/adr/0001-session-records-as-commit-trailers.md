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
- **A git `commit-msg` hook to add the trailers.** Rejected for now: it needs `core.hooksPath`, which collides with Husky and must be set in every fresh clone. The recorder rewrites the agent's `git commit` command instead, without granting it permission.

## Consequences

- A session's activity after its last commit is not recorded, and a session that never commits leaves nothing. Where a transcript is cached it is preferred, since it covers that tail.
- The record is public wherever the repo's history is. It never holds message text.
- Each repo carries its own copy of the recorder: upgrading it means running `init` again in that repo.
- The recorder's human message count can differ slightly from a transcript's, which tells slash commands and interrupts apart more precisely.
- The human messages of a session that orchestrates sub-agents stay orchestration: they are recorded on that session's own commits and are not split across the tickets its sub-agents delivered.
