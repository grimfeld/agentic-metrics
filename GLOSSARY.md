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
The time actually spent working on a ticket: its work phase with the idle taken out. The headline measure of how long a ticket took.
_Avoid_: Effort, hands-on time, work time
