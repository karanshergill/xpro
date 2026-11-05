# ADR-036: Reuse the audited reset service in a private control

**Status:** Accepted | **Date:** 2026-10-29

## Problem

- **Operator action:** masters need a form for the already implemented password
  reset service. T040 will supply the STMS login detail page.
- **Unknown result:** a lost response may follow a complete password/session/
  audit save. Another submission is a new reset, not recovery.
- **Wrong context:** an open form's selected login or signed-in master can change
  while secret input or an asynchronous response still belongs to the old form.

## Decision

- **Inline control:** expose ResetPassword with the selected login ID/email and
  original page login ID as props. T040 must obtain them from authorized page
  data. Reuse existing Hub fields, Button, TanStack Form and translations.
- **Service:** call the registered Hub POST action. Keep ADR-024's native hashing,
  atomic credential/token/session/audit batch and master-only policy unchanged.
  Native admin setUserPassword alone still does not provide this whole operation.
- **Actor:** after fresh master authorization, compare the optional
  x-page-login-id hint before calling reset. It can refuse another actor but
  cannot grant permission. Existing callers without the hint retain their
  existing authentication requirements. No preliminary identity read is added.
- **Input:** require only the ordinary password; comments are optional and blank
  comments are omitted. Preserve the password verbatim and nonblank comments.
  Add no current-password field, temporary expiry or forced password change.
- **Form:** use native POST, disable before hydration and during submission, read
  FormData for silent autofill, and validate on blur/submit. Keep values after
  errors and focus their fields or the safe error summary. Both blurs preserve
  pointer activation. Long email labels wrap at narrow widths.
- **Unknown reply:** explain that the reset may have completed. Keep the values
  for external verification; a deliberately submitted next reset is a new
  audited action. Never automatically retry, persist secrets in browser storage
  or add a creation-style replay reference.
- **Self-reset:** use the same service and rules. On confirmed success, clear
  input and offer normal sign-in. On an unknown reply, explain that sessions
  may already have ended and the submitted password may already work.
- **Form identity:** key state by target and page actor. New context gets an
  empty form, and an old response cannot mark the new context successful.
  Match a successful receipt to the requested target before clearing input.
- **Transport:** extract creation's existing HTTP-preserving adapter into one
  Hub helper and reuse it. A pre-Start refusal keeps its actual safe error and
  reference instead of becoming an ambiguous result.
- **Handover:** show success without retaining the password and keep delivery
  through the operator's usual outside channel.

## Alternatives

- **Native admin client calls:** bypass the established atomic audited operation.
- **New modal, page reader or production route:** unnecessary for the reusable
  control task; the approved STMS host belongs to T040.
- **Automatic retry or a reset recovery ledger:** conflicts with the existing
  new-action semantics and adds unnecessary state.
- **Only keying UI state:** cannot enforce authority at the actual write.
- **Keeping one form across targets:** risks carrying secret input or a late
  success into another login.

## Impact

- **Scope:** T030 delivers the reusable control. T040 page integration and hosted/
  release acceptance remain pending. No dependency, schema, runtime, Vite,
  Worker binding or deployment changes are needed.
- **Tests:** a guarded browser-only route supplies props from real native fixture
  records and mounts this control. It substitutes no authentication, permission
  decision or reset service. Worker tests still verify the atomic state/audit
  outcomes. Temporary fixtures and processes are removed after verification.
- **Constitution:** global identity remains in the Hub and tenant data stays
  local. No data-safety exception is added. Exact source/document changes need
  the normal product-owner diff approval.

## References

- [Better Auth admin plugin, installed 1.7.12](https://github.com/better-auth/better-auth/blob/v1.7.12/docs/content/docs/plugins/admin.mdx)
- [Native admin implementation, installed 1.7.12](https://github.com/better-auth/better-auth/blob/v1.7.12/packages/better-auth/src/plugins/admin/routes.ts)
- [TanStack Form async submission](https://tanstack.com/form/latest/docs/reference/interfaces/FormState#issubmitting)
- [Start per-call fetch](https://tanstack.com/start/latest/docs/framework/react/guide/middleware)
- [React form state and keys](https://react.dev/learn/preserving-and-resetting-state#resetting-a-form-with-a-key)
