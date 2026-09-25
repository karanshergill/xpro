# ADR-004: Record IDs are UUID v7

**Status:** Accepted | **Date:** 2026-09-25

## Problem

- Every record needs an ID that is unique across all workspaces, because a
  workspace's data can move between a Durable Object and an external
  database.
- IDs are created in the app, since each workspace has its own database.
- Lists are mostly sorted and searched by creation order, so IDs that follow
  creation time keep database indexes fast.

## Decision

- Every record ID, including sign-in records, is a UUID version 7, created
  with the uuid package.
- Customer-facing document numbers (invoice numbers and similar) are
  separate, readable numbers and are not IDs.

## Rejected options

- **Counting numbers (1, 2, 3…):** they collide when data from two databases
  is combined, and they reveal how many records exist.
- **UUID version 4, the platform's built-in kind:** fully random, so new rows
  land all over the index and slow it down.
- **IDs with a readable type prefix (such as `usr_…`):** easier to read in
  logs, but a custom format with its own generator to maintain.

## Impact

- **Better:** IDs never collide across workspaces or databases, and they
  stay in creation order.
- **Costs:** one small dependency, and IDs are long and unreadable, which is
  why document numbers are kept separate.
