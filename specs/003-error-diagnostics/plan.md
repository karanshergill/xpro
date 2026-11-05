# Safe error diagnostics

- **Approved scope:** make unexpected failures easier to locate using the existing
  shared reporter, request IDs and Cloudflare Workers Logs.
- **Current gap:** the reporter records only an event and request ID. It does not
  identify the app or operation that failed.
- **Log contract:** emit exactly `event`, `requestId`, `app` and `operation`.
  Keep `core_unexpected_error` as the event. Require the location for every report.
- **App label:** identify the code currently running: Hub, router or workspace.
  Shared access checks receive the executing app explicitly; a workspace ID does
  not determine which app is executing.
- **Operation label:** use a fixed label written in code for the failed action.
  Labels never come from request values, paths, URLs, identifiers or caught errors.
- **Privacy:** select the four fields explicitly. Do not copy extra properties,
  request bodies, headers, cookies, passwords, tokens, MFA material, personal
  details, database errors, error messages, causes or stack traces.
- **Existing behaviour:** preserve public error bodies and statuses, request-ID
  propagation, access decisions, error-report deduplication and action outcomes.
  Background cache or picture-cleanup failures keep their existing handling.
- **Implementation:** extend `reportUnexpectedError` in Core and update every
  caller, including auth callbacks and the private initial-master script. Use the
  existing console output; the application does not manage log files or introduce
  a logging service or dependency.
- **Permanent checks:** compare complete emitted events and generic public errors.
  Cover Hub, router and workspace failures, shared access checks in both apps,
  background failure reporting and secret-bearing requests/errors. Confirm that
  correlation stays correct between requests.
- **Local verification:** run the affected Workers tests, the complete Workers
  suite and type checks. Run additional build or browser checks where the changed
  boundaries need them. Temporarily break one new safety expectation to prove
  that its permanent regression fails, then restore the exact source.
- **Delivery order:** prepare the code and tests in an isolated copy, review and
  simplify them, then present the tested diff for approval. Update the server
  convention and diagnostics release evidence with the final behaviour and limits.
- **Hosted follow-up:** searchable hosted events, automatic invocation metadata,
  query-string privacy, tracing, retention and alert delivery require verification
  against an approved Cloudflare target and a separately approved configuration
  scope. Application log tests do not establish those controls.
- **Release status:** retain the release hold until the actual hosted and other
  outstanding release requirements have evidence and approval.
- **Constitution check:** keep workspace isolation, authentication, save semantics
  and the existing runtime intact. The approved scope adds diagnostic metadata
  and tests; existing project files change only after their exact diff is approved.
- **References:** [current reporter](../../packages/core/src/server/errors.server.ts),
  [server conventions](../../docs/conventions/server.md),
  [release requirements](../001-sign-in-and-accounts/checklists/release-review.md),
  [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
  and [structured logging](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
