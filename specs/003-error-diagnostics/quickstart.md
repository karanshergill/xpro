# Safe error diagnostics: local checkpoint

- **Scope:** implement the [approved plan](plan.md) through the existing Core
  reporter. [ADR-045](../../docs/adr/045-safe-error-locations.md) records the choice.
- **Application event:** emit exactly `event`, `requestId`, `app` and
  `operation`. The app is `hub`, `router` or `workspace`; operation labels
  are fixed in the reporting code.
- **Original coverage:** the local checkpoint covered 53 production reporting
  sites and 51 distinct operation labels. Access-check callers supplied the
  executing app explicitly. The value does not travel as authentication proof.
- **Privacy:** select the four fields rather than serializing a context, request,
  error or arbitrary metadata object. Extra properties, passwords, tokens,
  cookies, MFA material, identifiers, URLs and exception internals stay out.
- **Preservation:** existing public errors, request IDs, auth decisions, saves,
  report deduplication and background-failure outcomes retain their contracts.
  A source comparison confirms that the 47 affected production files outside
  the reporter contain only location arguments and the access-owner type field.
- **Triage:** use the request ID from the failure response to locate the event.
  Search its fixed operation label in the source to find the reporting boundary.
  Shared code records the executing app rather than inferring it from a
  workspace ID. Native callbacks keep their enclosing boundary's label.

Example application event:

```json
{"event":"core_unexpected_error","requestId":"00000000-0000-4000-8000-000000000001","app":"router","operation":"core_router_request"}
```

## Permanent checks

- **Reporter privacy:** each app reports only the four expected fields, even when
  context and location objects carry extra private properties. The public response
  remains generic and shares the logged request ID.
- **Cross-request correlation:** separate failures retain their own IDs, app and
  operation. Concurrent routed requests replace forged client IDs and keep private
  headers, body, query values and exception details out of the emitted events.
- **Shared access:** real failing Hub binding checks report either executing app,
  including `workspace` with a null workspace target.
- **Background failures:** a failed placement-cache write has its own router
  operation and the successful response's request ID. Picture cleanup retains its
  successful save and reports only the code-defined cleanup location.
- **Existing boundaries:** native auth, sign-in, MFA, profile, creation and master
  management regressions compare complete events and their public outcomes.

## Local verification

| Check | Result |
|---|---|
| Frozen dependency installation | Passed; existing lockfile and provider patch retained |
| Corrected focused Workers checks | 284 passed across nine files |
| Complete Workers suite | 2,110 passed across 114 files; zero failures, pending or skipped cases |
| Type checks | All app, package and test projects passed |
| Production builds | Web and Hub built; router dry run passed; generated Web routes returned to their exact baseline |
| Browser security journeys | All five checks in `security.spec.ts` passed through the isolated HTTPS wrapper using Chrome |
| Field-selection control | Copying extra context into the log made all three app privacy cases fail |
| App-owner control | Hardcoding Hub ownership made the workspace shared-check case fail |
| Control cleanup | Both production files restored to their exact hashes before the full green suite |

The initial run found old-format assertions in a shared test helper and two
incorrect expected operation labels. Those expectations were corrected and
verified; no production workaround or suppressed failure was introduced.

The five browser checks cover all three Workers' response policy, protected
framing, real sign-in/MFA/sign-out privacy, literal user text and native logout
confirmation. The previous full 225-case browser result remains T056 evidence;
this diagnostics change reran the security file only. The independent code
review found no Required or Critical finding.

## Hosted limits and release gate

- **Platform metadata:** the four-field contract covers the application's emitted
  event. Cloudflare may attach invocation metadata containing request URLs.
  Application log tests do not establish collector privacy or retention.
- **Hosted follow-up:** [T063](../004-cloudflare-test/quickstart.md#hosted-verification-t063)
  verified test collection/search, tracing, synthetic marker privacy, query
  redaction, account retention and a received native alert. The temporary alert
  resources were removed. Production collection, retention and ongoing alert
  configuration remain part of T064.
- **Diagnostic limit:** the labels identify a reporting boundary rather than
  storing exception internals. Add reviewed private diagnostics if location and
  request ID cannot isolate real failures.
- **Release:** retain the [release hold](../001-sign-in-and-accounts/checklists/release-review.md).
  This checkpoint does not approve deployment or the first real client.

References: [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
and [structured logging](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
