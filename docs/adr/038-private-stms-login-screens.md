# ADR-038: Private STMS login directory and management forms

**Status:** Accepted | **Date:** 2026-10-30

## Problem

- **Existing backend:** global master reads, lifecycle actions, identifier changes
  and password reset already enforce access, auditing and session revocation.
  Masters need screens without duplicating those rules.
- **Open pages:** sessions can expire or change while a master edits. A response
  can be lost after a committed change; replay can create another action.

## Decision

- **Pages:** use /stms/logins and /stms/logins/<loginId>; redirect /stms to the
  directory. Reuse the existing functions, DTOs and T030 reset control.
- **Authority:** freshly authorize the native master on each read/write.
  Successful reads add the actor ID in x-page-login-id. The optional original-page
  hint can only refuse an identity change after authorization, never grant access.
  Reuse this boundary for reset and all seven other management writes.
- **SSR:** allow direct read invocation only on configured-origin GETs for the
  directory or UUID-shaped detail page. Public RPC remains bounded JSON POST with
  exact Origin checks. Send private/no-store HTML with Cookie variation.
- **Directory:** keep query/offset in the address; use Router's serializer to
  preserve literal JSON-looking text and strip default values. Use native document
  links and a hydration-gated POST search form. Read the existing 25-record pages,
  newest first, and show six semantic table columns with visible sort direction.
- **Dates:** reuse the approved Temporal implementation through Core's single
  formatting doorway and platform Intl. Show explicit UTC in this global view;
  no personal time-zone setting exists yet.
- **Forms:** reuse TanStack Form, translations and field rules. Keep comments
  optional except for the Other suspension reason. Confirm suspend/archive and
  refuse self-suspend/archive. Preserve autofill, hydration/busy guards, errors,
  dirty sections and keyboard focus; allow table-only horizontal scrolling.
- **Initial focus:** use the standard preventScroll option when placing focus
  on a new page's heading, across Hub and workspace pages. Late hydration must
  not scroll a link away between mouse press and release. Each router uses its
  supported restoration callback to skip the initial render and retain later
  client restoration. Keep the initial-render flag inside each router factory.
  Error-field and user-triggered result focus keep their existing behaviour.
- **Outcomes:** read current metadata after confirmed changes. Offer explicit
  readback for uncertain replies; never automatically replay a write. A confirmed
  self-change shows success before renewed sign-in. Reuse T030's separate reset
  uncertainty guidance and clear successful password entries.
- **Drafts:** retain mounted forms behind the access dialog. Resume only after
  a fresh read as the original master; abort superseded reads. Keep drafts only
  in the open page, with no browser storage or recovery ledger.
- **Archives:** keep normal directory/search archive-free. A saved detail address
  supports restoration to its prior active/suspended state without old sessions.
  Add no archived-list API or additional-master management screen.

## Rejected options

- **New management services:** duplicate the existing audited atomic actions.
- **Pre-save identity request:** adds a roundtrip without replacing fresh
  authorization at the actual action.
- **Plain URLSearchParams serialization:** Router parses JSON-looking values;
  its serializer preserves their literal string type across reloads.
- **Client paging or persistent query cache:** unnecessary beside the small
  server pages and native document navigation.
- **Replay queue or stored drafts:** adds recovery state and risks repeating
  committed writes or retaining passwords.
- **Always skipping restoration:** later client navigation still needs reset and
  back-position restoration; skip only the initial render.
- **Archive search and role management:** outside the approved initial boundary.

## Impact

- **Reuse:** no dependency, schema, migration, runtime, Vite, Cloudflare or
  deployment configuration change. Existing backend data-safety decisions stand.
- **Constitution:** identity remains in the Hub; tenant data stays local. No new
  exception. Apply source/document diffs only after product-owner approval.
- **Limits:** draft recovery requires the page to remain open. Known-link-only
  archive restoration remains ADR-028's limit. Hosted journeys and full feature
  acceptance/release checks remain pending.

## References

- [TanStack Router search parameters](https://tanstack.com/router/latest/docs/framework/react/guide/search-params)
- [TanStack Router data loading](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading)
- [TanStack Form reset](https://tanstack.com/form/latest/docs/reference/classes/FormApi#reset)
- [Base UI Alert Dialog](https://base-ui.com/react/components/alert-dialog)
- [shadcn Table](https://ui.shadcn.com/docs/components/base/table)
- [Temporal implementation entry point](https://github.com/fullcalendar/temporal-polyfill#usage)
- [Browser focus without scrolling](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus#parameters)
- [Playwright hydration checks](https://playwright.dev/docs/navigations#hydration)
- [TanStack Router scroll restoration](https://tanstack.com/router/latest/docs/framework/react/guide/scroll-restoration)
