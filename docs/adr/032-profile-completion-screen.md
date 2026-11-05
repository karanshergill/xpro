# ADR-032: Profile-completion screen and UI foundation

**Status:** Accepted | **Date:** 2026-10-29

## Problem

- **Required details:** the page must ask only for missing or invalid profile
  fields and must not turn a completed profile into an editable form.
- **Continuation:** completion can start at the Hub or during a signed workspace
  sign-in. The screen must keep that signed state through validation failures.
- **First screen:** the approved form components, styling and translation tools
  are planned but have not yet been installed.

## Decision

- **Reader:** a readonly Hub server function returns only required field names.
  It uses the real native cookie and one shared access result. The protected
  check refuses inactive or unfinished logins before returning missing profile
  fields; only that incomplete-profile result opens the form.
- **Transport:** keep the existing exact-Origin JSON POST boundary for public
  server functions. Start may invoke the reader directly while rendering
  GET /complete-profile. The HTML response is private/no-store and varies by
  Cookie; the reader response also forbids caching.
- **Authority:** reuse Accounts' completion action and username/name/phone rules.
  The browser checks format, while the save decides uniqueness and reservations.
  Send only currently required fields; do not add availability requests on typing.
- **Form:** use TanStack Form and the used shadcn/Base UI controls in the Hub.
  Keep input on failure, show field errors and a summary, focus the first invalid
  field, and disable controls during submission. A country selector uses the
  approved phone library and localized region names.
- **Confirmation:** show "Your username can't be changed later" and require its
  checkbox. Editing the username clears confirmation. Already valid usernames
  have no input or confirmation control.
- **Hydration:** use the existing Router hydration hook before enabling controls.
  Native form method is POST. A live status is separate from the submit label,
  preserving the button's accessible name.
- **Activation:** each field owns its blur and submit validators. Do not clear
  validation layout during a pointer press that is moving focus to a form
  button: that can move the button before click and swallow activation.
  Keyboard blur still validates immediately; submission rechecks every field.
- **Races/replies:** refresh required fields after a stale-profile refusal while
  retaining other entered values. Do not retry writes automatically. Existing
  repeat-safe completion handles a deliberate retry after an unknown reply.
- **Destination:** direct Hub completion resumes /auth/destination. A signed
  workspace flow uses the native provider client and its signed-query extraction
  and server verification. Navigation uses the provider response, never a caller
  supplied destination.
- **Text/styles:** Paraglide compiles local message files using a pinned local
  plugin. Request-local middleware keeps server languages isolated; use no
  language URL rewriting. English is the initial language; en-XA exercises
  translation coverage and expanded text. Tailwind uses named light/dark tokens
  and logical spacing.
- **Ownership:** keep the used controls in the Hub until another app needs the
  same components (ADR-008). Keep the copied component license. No Query provider,
  new UI package, backend dependency or storage change is needed for this screen.
- **Checks:** browser tests create a fresh source copy, apply actual Hub
  migrations and issue native authentication cookies through trusted setup.
  They use local Workers and HTTPS with fake records; no xpro API is replaced.
  The runner owns its child processes and removes its copy, data and artifacts.

## Alternatives rejected

- **A separate profile read:** unnecessary; the live shared check already names
  the required fields without returning personal values.
- **GET public server functions:** would widen the existing POST-only boundary.
- **Custom form, phone or authentication engines:** duplicate approved libraries.
- **A new redirect parameter:** bypasses the provider's signed continuation.
- **Enabling controls before hydration:** can lose early interactions or allow
  native form navigation before handlers are attached.
- **One broad UI package now:** no second app currently needs these controls.

## Verification and limits

- **Workers:** 23 reader cases and 29 form/message cases cover all required-field
  combinations, refusal boundaries, strict phone/username rules, safe messages
  and concurrent request-local languages.
- **Browser:** real Chromium checks missing-only fields, native cookies, redirects,
  private HTML, unhydrated controls, keyboard/focus, confirmation, server errors
  and correction, busy state, lost replies, ended sessions and concurrent
  completion. They check accessibility, dark theme, narrow/RTL layout and pseudo
  language. The signed provider returns its registered callback after correction.
- **Controls:** weakened Origin checking, omitted confirmation and incorrect
  confirmation reset each fail their tests. The original files are restored.
- **Scope:** this is T016's screen checkpoint. T022's sign-in and session-return
  UI, the other feature screens and full browser/hosted acceptance remain pending.
  The callback check does not claim a complete browser token-exchange journey.

## References

- [Start authentication and hydration](https://tanstack.com/start/latest/docs/framework/react/guide/authentication)
- [Start server functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)
- [TanStack Form validation](https://tanstack.com/form/latest/docs/framework/react/guides/validation)
- [shadcn Base UI controls](https://ui.shadcn.com/docs/components/base/button)
- [Base UI checkbox](https://base-ui.com/react/components/checkbox)
- [Paraglide with TanStack Start](https://github.com/opral/paraglide-js/tree/main/examples/tanstack-start)
- [Tailwind Vite setup](https://tailwindcss.com/docs/installation/using-vite)
- [Native OAuth continuation](https://better-auth.com/docs/plugins/oauth-provider)
- [Playwright accessibility checks](https://playwright.dev/docs/accessibility-testing)
