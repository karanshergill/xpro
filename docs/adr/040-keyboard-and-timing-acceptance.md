# ADR-040: Keyboard and local timing acceptance

**Status:** Accepted | **Date:** 2026-10-30

## Problem

- **Coverage:** existing screen cases check many individual controls and states.
  T042 needs complete keyboard paths, scans of every feature screen and clear
  measurements for sign-in and master search/suspension.
- **Limits:** local Vite/workerd and substituted outside bot verification cannot
  establish hosted production performance or complete accessibility compliance.

## Decision

- **Reuse:** keep the existing isolated three-app browser runner, native logins,
  real actions, storage and OIDC. Add one dedicated test file and six independent
  native fixture actors; add no production endpoint, dependency or configuration.
- **Keyboard:** reach controls with actual Tab traversal and activate through
  Enter/Space. Use native select typeahead, checkbox activation and crop arrows.
  The native file chooser is opened by Space; its OS selection is supplied through
  Playwright. No programmatic focus or pointer activation replaces keyboard paths.
- **Forms:** scan normal, busy, invalid and confirmation states with full-page axe.
  Check clipboard paste and native input-value autofill without React events.
  Keep the existing narrow/RTL/dark, lost-reply and additional autofill cases.
- **Return:** retain the exact URL, textarea, number text, select and checkbox
  through genuine popup sign-in and the registered fresh-access resume handler.
  Check dialog focus containment after the library's focus guards settle. Refuse
  stored form values while allowing Router's existing scroll-position storage.
  This does not assert browser-native focus-event delivery in headless mode.
- **Sign-in:** use Chromium's request-network emulation at 50 ms minimum
  request-to-response-header latency, 10 Mbps down and 2 Mbps up. Measure from
  actual keyboard submission to the exact destination and visible main heading.
  Assert less than 3,000 ms for all five destinations; do not include initial
  sign-in-page setup or later destination hydration in that visible-page metric.
- **Master:** measure actual keyboard search entry, opening the target, choosing
  a reason and confirming suspension through the saved Suspended status. Assert
  less than 60,000 ms; this workflow uses the unthrottled local connection.
- **Reports:** print/attach only goal, elapsed time, limit and declared environment.
  Keep passwords, identity values and session/protocol details out of these records.
  Delete per-run reports with the runner's other temporary resources.

## Rejected options

- **Axe alone:** cannot establish usable keyboard paths or complete accessibility.
- **Click or programmatic-focus shortcuts:** cannot prove Tab reachability.
- **Fixed sleeps/network-idle readiness:** hide the actual visible outcome and
  can wait on unrelated development activity.
- **New performance infrastructure or production config changes:** unnecessary
  for local measurements; hosted acceptance requires separately approved setup.
- **Treat local speed as a hosted guarantee:** omits cold Workers, real bot
  verification, deployment assets, real people and serving-location conditions.

## Impact

- **Scope:** test and evidence changes only. Identity, access, storage, data-safety,
  runtime, Vite, Cloudflare and deployment rules remain unchanged.
- **Interpretation:** each browser case has a fresh context; the development
  servers are shared and warmed by earlier cases. Outside SDK routing disables
  browser HTTP caching. Vite's unbundled assets may hydrate slowly under throttling;
  that is separate from the explicitly measured visible-destination deadline.
- **Outstanding:** repeat timings against approved hosted production builds and
  real verification. Automated keyboard/axe checks do not replace assistive-tech,
  manual or inclusive-user assessment. T043–T045 and release gates remain pending.

## References

- [Playwright accessibility testing and its limits](https://playwright.dev/docs/accessibility-testing)
- [Playwright keyboard input](https://playwright.dev/docs/api/class-keyboard)
- [Playwright focus assertions](https://playwright.dev/docs/api/class-locatorassertions#locator-assertions-to-be-focused)
- [Chromium request-network conditions](https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-emulateNetworkConditionsByRule)
- [Base UI popup focus](https://base-ui.com/react/components/alert-dialog#popup)
