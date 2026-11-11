---
status: accepted
---

# A teleported cloud session is read as a transcript, linked by branch; its session records win over it

A cloud session that left neither a transcript nor a session record is known only through its commits. Teleporting it (`claude --teleport`) brings a copy of its history to the device. We decided that `collect` reads that copy like any transcript, and that when the same tickets also have session records from cloud commits, the records are read and the teleported copy is not: ADR 0001's rule (a transcript wins) is reversed for this one kind of transcript.

## What the prototype showed

Observed on 2026-11-11, Claude Code 2.1.322, teleporting cloud session `session_01SZbScWWRakz752LVjegrCw` (its commits' `Claude-Session:` trailer) into this repo's clone:

- **It checks out the session's branch in the folder it runs in.** Teleporting in the clone switched it to `ccr-5fa1da6c-pl61pk`. Run it in a clean worktree or a second clone.
- **It runs non-interactively to no effect.** From a shell escape inside another session it printed nothing and wrote nothing; it needs a terminal of its own.
- **The id it took was not the trailer's.** It was given `cshk_01SZbScWWRakz752LVjegrCwDVucZBr55sk4iVVEtY5LSy`, which starts with the trailer's id after another prefix and carries more. Whether `session_…` is accepted as is was not tested; the interactive picker (`claude --teleport` with no id) needs none.
- **The copy is written only once the session does something.** While it sat open, no file existed. After one reply and an exit, `~/.claude/projects/<the clone's folder>/<new id>.jsonl` held the whole cloud history: 823 lines from the session's first, every API response with its usage (297), the human messages (13), two sub-agent spawns. The installed plugin's SessionEnd hook cached it.
- **It is a new session.** Every line carries the new local session id (`28ecdd5b-…`), the local folder as `cwd`, and the session's branch as `gitBranch`. The cloud id appears nowhere in it, so neither the `Claude-Session:` trailer nor a record key (a hash of the session id) can name it. One line marks it: an `attachment` of type `remote_session_change`.
- **Sub-agent transcripts are not copied.** The spawns are in the copy; their own transcripts are not.
- **The reply sent to make it write is in the copy**, as a human message and activity at teleport time.

`collect` linked the copy, by its branch, to the ten tickets that branch delivered, as for any session whose branch is a ticket PR's head.

## Consequences

- A session's records and its teleported copy can't be matched by key. A teleported transcript (one with a `remote_session_change` line) is dropped from a ticket that also has session records from cloud commits, so a cloud session is never counted twice; where no record exists, the copy is the only source and is read.
- The copy has the session's token counts, so cloud work gets a cost (where its models are in the price table), but its sub-agents have only their spawn, not their own transcripts.
- The message sent to make the copy write counts as a human message, at teleport time.
- `doctor` suggests teleporting from the picker, naming the session's link, and in a separate worktree, not the trailer's id as a command argument.
