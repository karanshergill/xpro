# ADR-008: UI kit

**Status:** Accepted | **Date:** 2026-10-06

## Problem

- Screens need ready-made, accessible components (buttons, dialogs, menus,
  tables, forms) on top of Tailwind CSS.
- Each workspace's branding must be able to change colours in one place.
- Right-to-left languages must be possible later without rewriting screens.

## Decision

- shadcn/ui with Base UI as its foundation.
- Components are copied into our own code, so we own and can change them.
- Set up right-to-left ready from day one (start and end, never left and
  right).
- A local test confirmed setup, type checks, build and server rendering on
  the Workers runtime.

## Rejected options

- **shadcn/ui on Radix:** no longer shadcn's default foundation.
- **shadcn/ui on React Aria:** its shadcn support was only two months old.
- **Building our own components:** slow, and accessibility is hard to get
  right.

## Impact

- **Better:** accessible components from day one; full control, since the
  code is ours; colours come only from named design tokens.
- **Costs:**
  - updates are not automatic: each component is compared with ours before
    updating
  - a shared UI package is created when a second app needs the same
    components
