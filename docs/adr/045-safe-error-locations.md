# ADR-045: Safe locations in error diagnostics

**Status:** Accepted | **Date:** 2026-11-01

## Problem

- **Gap:** an unexpected failure has a request ID but no app or operation label.
  Finding its source requires guessing which boundary reported it.
- **Privacy:** caught errors and request data can contain credentials, MFA
  material and personal details, including in library messages and causes.

## Decision

- **Contract:** require a location at every Core report. Select only the fixed
  event, request ID, executing app and a code-defined operation label for output.
- **Ownership:** callers supply their own fixed labels. Shared access checks
  receive the executing app explicitly; workspace identity does not imply it.
- **Boundaries:** preserve existing responses, correlation, deduplication and
  action outcomes. Native logger callbacks retain their enclosing boundary label.
- **Transport:** use the existing JSON console output supported by Workers Logs.

## Rejected options

- **Raw exceptions with text redaction:** messages, causes and arbitrary nested
  properties can disclose secrets; an allow-list of output fields is simpler.
- **A new logging SDK or service:** unnecessary for recording these four fields.
- **Guess the app from a workspace ID:** Hub code can also check a workspace.

## Impact

- **Local evidence:** permanent privacy, correlation and real-boundary checks are
  recorded in the [diagnostics checkpoint](../../specs/003-error-diagnostics/quickstart.md).
- **Limit:** locations help isolate a failing action without capturing exception
  internals. Review private diagnostics if these labels cannot isolate failures.
- **Release:** hosted search, metadata privacy, tracing, retention and alerts
  still require target-specific evidence and approval before the first client.

Reference: [Workers structured logging](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
