# ADR-002: Save helper

**Status:** Accepted | **Date:** 2026-10-06

## Problem

- One business action often changes several records, which must be saved
  together or not at all.
- The Durable Object add-on for Kysely blocks Kysely's own all-or-nothing
  method.

## Decision

- Every save with more than one step runs ordinary Kysely code inside the
  Durable Object's own all-or-nothing block (`ctx.storage.transaction`),
  through one save helper.
- If any step fails, or a business rule fails, every step is undone.
- No outside call ever happens inside a save. Outside calls happen after
  it, through outgoing messages.
- A local test confirmed: all steps saved on success; nothing saved when
  the third step failed or a rule failed after the writes; reads inside a
  save see its earlier writes; 500 invoices numbered at the same moment
  with no duplicates and none lost.

## Rejected options

- **Building the steps with Kysely and running them as plain SQL in the
  one-step block:** also all-or-nothing, but code cannot read and decide in
  the middle of a save, so steps such as numbering must be squeezed into
  single SQL statements.
- **Relying on writes being grouped automatically:** not guaranteed once
  code waits between steps.

## Impact

- **Better:** saves read naturally (read, decide, write), and have the same
  shape as all-or-nothing saves in PostgreSQL.
- **Costs:**
  - each workspace runs its saves one at a time, so a slow step inside a
    save delays everyone in that workspace (measured: 30 saves each waiting
    30 ms took about one second)
  - throughput is measured again under load before the first client
