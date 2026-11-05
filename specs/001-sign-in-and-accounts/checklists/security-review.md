# Security review: Sign-in and Accounts

- **Scope:** review the implemented local feature against every item in
  [the reusable checklist](../../../docs/SECURITY_CHECKLIST.md). The checklist
  stays reusable; this document records the evidence and remaining work.
- **Meaning:** checked means supported by source inspection and the named local
  regression tests. It does not mean hosted release or complete privacy approval.
- **Hosted follow-up:** [T063](../../004-cloudflare-test/quickstart.md#hosted-verification-t063)
  adds scoped test evidence for real access/refusal, session revocation, private
  pictures and collector privacy. Production and product-privacy requirements
  remain in the [release review](release-review.md).
- **Decision:** [ADR-041](../../../docs/adr/041-shared-response-security.md) records
  the response policy. Existing approved shortcuts retain their stated limits.

## Security

| Checklist item | Assessment and permanent evidence |
|---|---|
| Signed in is not enough | Checked locally. [Access policy](../../../apps/hub/src/auth/access-policy.test.ts), [Hub access](../../../apps/hub/src/auth/hub-access.test.ts), [master boundary](../../../apps/hub/src/functions/master-request.test.ts) and [workspace requests](../../../apps/web/src/workspace/request.test.ts) check current status, completed creation and permission. [Native MFA access/revision tests](../../../apps/hub/src/auth/mfa/protection.test.ts) and the [MFA evidence](../../002-master-mfa/quickstart.md#t056-final-convergence-checkpoint) also require completed second-factor proof for global masters. Native write routes remain restricted; the [browser acceptance map](browser-acceptance.md) includes direct-route bypass cases. |
| Safe creation retries | Checked locally. [Creation policy](../../../packages/accounts/src/create-login/create-login.test.ts), [storage](../../../packages/accounts/src/create-login/create-login.db.test.ts) and [fault cases](../../../tests/support/creation-faults.db.test.ts) cover the saved reference, changed permissions, conflicts and incomplete-access refusal. Browser cases exercise the real failed save and retry. |
| Bounded input | Checked for xpro server functions. [JSON input](../../../packages/core/src/server/input.test.ts), [form input](../../../packages/core/src/server/form-input.test.ts) and [transport](../../../packages/core/src/server/server-functions.test.ts) bound parsing before deserialisation; action schemas bound fields, searches and counts. [Picture tests](../../../apps/hub/src/functions/picture.test.ts) enforce upload limits. Native protocol parsing remains Better Auth's responsibility rather than a new custom parser. |
| Only what's needed | Checked for xpro screen responses. [Profile](../../../apps/hub/src/functions/profile.test.ts), [creation](../../../apps/hub/src/functions/creation-page.test.ts) and [login reads](../../../apps/hub/src/functions/logins.test.ts) retain explicit DTOs. MFA verification uses an allowlisted public result; setup material is limited to its guarded private response. Other native authentication responses keep their protocol contract. |
| Nothing secret in logs | Checked locally. Application error reporting emits exactly the fixed event, request ID, app and operation labels, excluding library messages, arguments and request data. The [diagnostics checkpoint](../../003-error-diagnostics/quickstart.md) records cross-app privacy and correlation evidence. [Error tests](../../../packages/core/src/server/errors.test.ts) and [privacy tests](../../../apps/hub/src/auth/privacy.test.ts) cover successful, refused and genuinely failing sign-in. [Browser privacy](../../../tests/e2e/security.spec.ts) checks real session values and issued codes against audit rows and navigation URLs. The one-use code is allowed only on the exact OIDC callback; passwords, tokens and cookies are forbidden in navigation parameters. [MFA privacy](../../../tests/e2e/mfa.spec.ts) additionally checks intended setup/backup fields, TOTP/password exclusion, browser diagnostics and private-state clearing. T063 inspected the named test collector and policy Issue metadata; the actual production collector and retention still need review. |
| Safe redirects | Checked locally. [OIDC protocol tests](../../../apps/web/src/auth/oidc-protocol.test.ts), [Hub tests](../../../apps/hub/src/auth/hub.test.ts) and [router tests](../../../apps/router/src/router.test.ts) retain approved origins, exact callbacks and local return paths. |
| No user HTML | Checked locally. Screens render user values through React text interpolation; no raw user-HTML sink was found. [Browser security](../../../tests/e2e/security.spec.ts) saves an HTML-shaped name and verifies literal directory text without an image or script execution. |
| No secrets in local storage | Checked locally. Authentication uses secure HttpOnly cookies. [Session](../../../tests/e2e/workspace-session.spec.ts) and [keyboard](../../../tests/e2e/accessibility.spec.ts) cases retain mounted drafts without stored form values. Router's existing scroll-position storage remains allowed. |
| Requests from our own pages | Checked locally. [Transport tests](../../../packages/core/src/server/server-functions.test.ts), [sign-in protection](../../../apps/hub/src/auth/sign-in-protection.test.ts) and [native policy](../../../apps/hub/src/auth/auth-policy.test.ts) preserve origin/CSRF checks. New privacy cases reject cross-site null-Origin logout while the actual no-referrer native confirmation succeeds in the browser. |
| No framing | Checked for Worker documents. [Browser security](../../../tests/e2e/security.spec.ts) embeds a genuinely authorised customer document and verifies that its protected content cannot render. Both frame-ancestors and X-Frame-Options are set at the public boundary. |
| Security headers | Checked for returned Worker responses. [Response tests](../../../packages/core/src/server/security.test.ts) cover ordinary/error/redirect/empty/streaming/upgrade responses, separate cookies and existing CSP. Browser cases cover the Hub, workspace and local router. Platform static assets and edge-generated responses remain hosted checks. |
| Clean uploads | Checked locally within the accepted image-binding limit. [Processing tests](../../../apps/hub/src/functions/picture-processing.test.ts) cover bounded processing, clean output and failures; [private reads](../../../apps/hub/src/functions/picture.test.ts) cover access. Real hosted image metadata/fidelity remains pending because the local binding is not a hosted image service. |
| Private source maps | T056 checked all three local builds: the Hub's 40 and workspace's 6 public client files contain no `.map` files or `sourceMappingURL` markers. Development Vite maps are distinct from these production assets. Error-reporting upload and hosted asset exposure remain deployment work; no source-map configuration is changed here. |
| Safe patterns | Checked by source review and [indexed login search](../../../packages/stms/src/logins/logins.db.test.ts). User searches are bounded literal data in parameterised queries; no user-built regular expression or raw user-HTML evaluation was found. |

## Privacy

| Checklist item | Assessment and remaining work |
|---|---|
| Only needed data | Checked for this feature's declared name, email, username, phone and optional private picture. Private profile/login DTOs expose only relevant fields. Consent, legal basis and a complete organisation-wide data inventory are separate product work. |
| Deletion requests | Outstanding. The profile page has no request-deletion action or privileged review workflow. Do not treat profile editing or archiving as an implemented privacy request. |
| Anonymised, not deleted | Outstanding. No approved anonymisation workflow is implemented. Existing archive/restore retains personal details and audit history. |
| No personal details in audit entries | Automatic structured audit fields use login IDs and fixed action/outcome/reason codes; the new privacy tests reject submitted credentials, identifiers and issued session/code values in those records. Optional human-written comments remain free text and can contain personal details; no claim of automatic comment redaction is made. A privacy/comment policy is outstanding. |
| Retention stated | Outstanding. Authentication/session lifetimes are configured, but a retention policy for personal records, pictures, audits and backups has not been approved. Do not infer retention from token expiry or archive behavior. |

## Remaining acceptance

The historical T043 verification passed 1,780 Workers tests in 89 files, 181 browser cases,
nine type projects and three builds. Native schema comparison and frozen install
also pass; the dependency audit found no vulnerabilities in 427 packages. Removing
both frame protections makes the browser test fail on actual visible embedded
content; restoring them passes. The read-back fixture regression also fails before
the initialization fix. No mutation or temporary diagnostic code is retained.

- **Hosted:** verify headers on static/edge responses, real Workers for Platforms
  dispatch, image metadata/fidelity, production client assets and observability.
- **Policy:** review strict script CSP and HSTS with actual deployment domains
  and assets. Neither is silently enabled in this application-only change.
- **Privacy:** approve and implement the outstanding request/anonymisation and
  retention decisions separately. Free-text audit comments need explicit policy.
- **MFA follow-up:** [T056](../../002-master-mfa/quickstart.md#t056-final-convergence-checkpoint)
  records native enrollment, second-factor sign-in, revision/revocation guards,
  private setup/backup responses and the full local MFA/browser evidence. The
  T043 results above remain its historical baseline.
- **Release:** the [release assessment](release-review.md) still withholds deployment
  and first-client approval. Production diagnostics, hosted acceptance, operations
  and privacy requirements remain open; local MFA completion does not satisfy them.
