# ADR-037: Own-profile forms and private picture revisions

**Status:** Accepted | **Date:** 2026-10-29

## Problem

- **Own details:** all active users, including masters, need to edit their own
  name, phone, password and picture. Email and username remain read-only here.
- **Existing services:** Accounts already supplies these writes, native password
  handling and bounded private picture storage. Only the page and reads are missing.
- **Open drafts:** expired or changed browser credentials must not lose drafts or
  save one person's entries to another person's login.

## Decision

- **Page:** expose /profile with separate details, picture and password sections.
  Reuse Hub controls, TanStack Form, translations and Accounts field rules.
- **Private read:** use fresh native authentication and Core protected access,
  then one indexed Accounts read. Return only the actor ID, email, username,
  name, international phone and optional picture revision. Never return the R2 key.
- **Actor:** send the original page login ID as the existing x-page-login-id
  hint. Compare it after fresh authorization on reads and all four own-profile
  writes. It can refuse a changed actor, never authorize one. Add no pre-save read.
- **Phone:** derive the region and national number from the stored international
  number. If no region is known, retain the full number and require a deliberate
  region choice when saving; never invent one.
- **Cropping:** pin react-image-crop 11.1.2 for controlled, accessible square
  selection. Check original size and supported signatures before decoding. Use
  browser Canvas to draw the selected region into a PNG capped at 512 pixels,
  without upscaling. Revoke selected-file URLs on replacement, discard or unmount.
- **Upload:** send that square through the existing one-file multipart endpoint.
  Keep the server's independent size/content checks, native Images sanitation
  and ADR-026 storage rules. Add no coordinate protocol or original-file storage.
- **Serving:** GET/HEAD /api/v1/profile-pictures/<revision> authenticates afresh,
  derives the actor's current key and requires an owned matching revision. Missing,
  removed or stale revisions return 404. Never accept a caller-selected key or
  login. Send only PNG with private/no-store, Vary: Cookie and nosniff headers.
- **Display:** show a circular saved picture or whole-grapheme initials from
  the first and last name words. A failed image read falls back to initials.
- **Forms:** disable before hydration and during writes, use native POST and
  FormData for autofill, and validate on blur/submit. Guard pressed submit
  buttons against blur-driven layout changes. Keep keyboard checks,
  field errors, summaries and focus. Preserve other sections' dirty input.
- **Session loss:** keep forms mounted but inert behind the existing AlertDialog.
  Sign-in opens a new tab. Only a fresh read as the original actor resumes the
  page; superseded reads are aborted. Never replay a write automatically.
- **Password:** retain ADR-025's native current-password check and replacement
  cookie. On an uncertain response, retain both entries and explain that sessions
  may have ended and either password may remain current. Ask the person to check
  normal sign-in before deliberately submitting again. Clear secrets on success.
- **Picture result:** after confirmed upload/removal, read the new revision once.
  An uncertain result offers an explicit read without repeating the write.

## Rejected options

- **Custom crop controls:** unnecessary beside the approved maintained component.
- **Library canvas helper:** allocates the natural crop size times device pixel
  ratio; the standard Canvas draw operation provides a bounded output directly.
- **Server crop coordinates:** add multipart fields and processing contracts when
  the existing endpoint already accepts a sanitized square.
- **Public bucket URLs:** bypass current-session, owner and current-key checks.
- **Client identity as authority:** cannot enforce access at the actual read/write.
- **Persistent drafts or retry queues:** unnecessary for this page and would
  retain passwords or introduce write replay.

## Impact

- **Dependency:** the crop component is React-only, has no runtime dependencies
  and no import-time Node or DOM requirement. Local Workers SSR, builds and real
  browser tests verify this installed version. No configuration or schema changes.
- **Limits:** drafts last only while the page stays open. Native password and
  R2/D1 save limits remain exactly those in ADR-025/026. Hosted Images fidelity,
  deployed journeys and full feature/release acceptance remain pending.
- **Constitution:** identity and pictures remain in the Hub; tenant data stays
  local. No new data-safety exception. Source and document diffs need ordinary
  product-owner approval before application.

## References

- [Published crop component 11.1.2](https://www.npmjs.com/package/react-image-crop/v/11.1.2)
- [Crop component source at the published revision](https://github.com/dominictobias/react-image-crop/tree/2cd4d49b36ec9a29a63b27394ec29ade5646dc99)
- [Native password route, installed Better Auth 1.7.12](https://github.com/better-auth/better-auth/blob/v1.7.12/packages/better-auth/src/api/routes/update-user.ts)
- [TanStack Form reset and default values](https://tanstack.com/form/latest/docs/reference/classes/FormApi#reset)
- [Phone regions and non-geographic numbers](https://github.com/catamphetamine/libphonenumber-js#non-geographic)
- [R2 Worker reads](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
