# agentic-metrics

Measures an agentic engineering workflow: how long delivered work took, how much of it a person had to steer, and what it cost.

## Language

### Work

**Ticket**:
A unit of delivered work: an issue with at least one delivered pull request, or a delivered pull request linked to no issue.
_Avoid_: Task, story

**Batch**:
Several tickets landed on the default branch together through one integration pull request.
_Avoid_: Release, integration

**Abandoned pull request**:
A pull request closed without being merged. When it is linked to a ticket, it is one of that ticket's attempts.
_Avoid_: Failed PR, dropped PR

**Attempt**:
A pull request opened to deliver a ticket, whether it was merged or abandoned.
_Avoid_: Try, iteration

**Undelivered work**:
An issue whose pull requests were all abandoned. It is not a ticket.
_Avoid_: Waste, failed ticket

**Delivered**:
Reached the default branch. A batched ticket is delivered when its batch lands, not when its own pull request merges.
_Avoid_: Done, shipped, merged

### Time

**Activity**:
A timestamped trace of someone, person or agent, working on a ticket.
_Avoid_: Event, action

**Idle**:
Time within a ticket's lead time during which there was no activity on it: before the first activity, between bursts of activity, or after the last one.
_Avoid_: Waiting, downtime

**Lead time**:
Calendar time from a ticket becoming ready to it being delivered, idle included. It is the sum of queue, work and landing wait.
_Avoid_: Cycle time, duration, time to ship

**Queue**:
The first phase of lead time: from a ticket becoming ready to its first activity.
_Avoid_: Backlog time, wait to start

**Work**:
The middle phase of lead time: from a ticket's first activity to its last. It can contain idle.
_Avoid_: Cycle time, development time

**Landing wait**:
The last phase of lead time: from a ticket's last activity to it being delivered. For a batched ticket it includes waiting for the batch to land.
_Avoid_: Review time, merge time

**Active time**:
The time actually spent working on a ticket: its work phase with the idle taken out, counted once however many agents worked in parallel. The headline measure of how long a ticket took.
_Avoid_: Effort, hands-on time, work time

**Measured** / **Estimated**:
An active time is measured when it comes from a session's own record of its activity, and estimated when it is inferred from commit times alone. The two are never mixed in one figure.
_Avoid_: Exact, approximate, guessed

### Sessions

**Session**:
One Claude Code conversation working in a repo, on any device or in a cloud container.
_Avoid_: Chat, run

**Sub-agent**:
An agent a session spawns to do part of its work. Its time counts on the ticket it worked on; it receives no human messages.
_Avoid_: Worker, child session

**Orchestration**:
What a session does when it belongs to no ticket: planning, spawning sub-agents, landing batches. Its human messages and active time are reported apart from any ticket's.
_Avoid_: Coordination, overhead, planning time

**Session record**:
The counts a session leaves on the commits it makes: how long it has been active, how many human messages it has received and how many sub-agents it has spawned. It holds no message text.
_Avoid_: Stamp, session log, telemetry

**Transcript**:
A session's full log, kept only on the device it ran on. Where one is available it is preferred to the session record.
_Avoid_: History, chat log

**Human message**:
A prompt a person typed into a session, as opposed to anything the tooling or another agent wrote.
_Avoid_: Interaction, intervention, prompt

**Interrupt**:
A person stopping a session in the middle of its turn. It is not a human message.
_Avoid_: Cancel, abort, intervention

### Quality

**Regression**:
A bug caused by a delivered ticket.
_Avoid_: Breakage, defect

**Declared** / **Inferred**:
A fact is declared when a person wrote it down by convention (a `caused-by:` line, a label), and inferred when the tool deduced it from traces such as reverts or the history of changed lines. The two are never pooled in one figure.
_Avoid_: Manual, automatic, detected

**Kind of change**:
What a ticket did to the code: a feature, a fix, a refactor, a chore, docs or tests.
_Avoid_: Type, category

### Data

**Gap**:
Data a metric needs that is missing, with the reason it is missing.
_Avoid_: Hole, missing data, blind spot
