---
status: accepted
---

# The recorder reads token counts from the transcript, which can lag a turn

Amends ADR 0001, which rejected reading the transcript when committing because it is written asynchronously and can lack the current turn. Session records need token counts so that work done in a cloud session gets a cost, and no hook reports token usage. We decided the recorder reads token counts, per model and category, from the session's transcript when it adds a record. Its other counters stay in its own state file, updated by hooks.

## Consequences

- A record's token counts can miss the turn that made the commit. Counts are cumulative, so the session's next commit catches them up. Only the tokens a session spends after its last commit are never recorded, and that tail was already unrecorded.
- A transcript that cannot be read leaves the tokens out of the record, never zero: the ticket's cost is unknown, as with a v1 record.
