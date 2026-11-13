---
status: accepted
---

# Enrichment proposes conventions; it never stores what the model concluded

An LLM can derive facts the conventions would otherwise supply: a ticket's kind of change, the ticket a fix's regression came from, the issue a PR delivers. We decided that enrichment, a plugin skill run on one ticket at a time, only proposes these facts. A person accepts each proposal, and accepting it writes the ordinary convention to GitHub: a `kind:*` label, a `caused-by: #N` comment, a `Closes #N` line. What the model concluded is then a declared fact like any other.

## Considered options

- **Storing the model's answers as inferred data in the local cache.** Rejected: the cache stays on one device, so another device would get different numbers or have to pay to compute them again. A model can also give a different answer on another run, which would break the rule that collecting again gives the same dataset.
- **Running enrichment over the whole repo through the API.** Rejected: many users have Claude Code but no API key, and enriching every ticket costs money for tickets nobody looks at.

## Consequences

- Every enriched fact went past a person and lives in GitHub, where every device sees it and the Action and `collect` read it unchanged.
- Enrichment writes to GitHub, so it asks first, for each ticket.
- The inferred regressions from reverts and `git blame` stay inferred: that tracing is deterministic and needs no one to accept it.
