# Local browser acceptance: Sign-in and Accounts

- **Scope:** map all 43 story scenarios to permanent tests of the implemented apps.
  Scenario numbers refer to [the specification](../spec.md#user-scenarios--testing-mandatory).
- **Browser:** tests use actual native authentication, Hub D1, workspace SQLite,
  access gates and actions. Only the outside Turnstile SDK/verification result is
  substituted. Fault and lost-response cases deliberately interrupt real operations.
- **Storage:** concurrency, atomic saves and hostile serialized requests also need
  Workers tests. A browser journey does not replace those checks.
- **Transport:** the customer address uses trusted HTTPS through the actual local
  router. Native provider JWKS and back-channel HTTP calls use test-only local
  Fetcher bindings to the actual Hub/router handlers. No issuer, signature,
  placement result or logout receiver is replaced.
- **Boundary:** local routing uses the accepted one-workspace fallback. Deployed
  Workers for Platforms dispatch, public DNS/certificates, hosted image fidelity,
  hosted performance goals and release acceptance are separate outstanding checks.

## Story 1: complete first sign-in

| Scenario | Permanent evidence |
|---|---|
| 1.1 Complete details skip completion | [Creation journeys](../../../tests/e2e/create-login.spec.ts): owner/internal and admin/external logins sign in through the form and reach app/Portal. |
| 1.2 Ask only missing/invalid details | [Profile completion](../../../tests/e2e/complete-profile.spec.ts): required-field combinations; [creation journey](../../../tests/e2e/create-login.spec.ts): missing phone blocks real OIDC until saved. |
| 1.3 No public registration or Account creation | [Sign-in](../../../tests/e2e/sign-in.spec.ts): no registration link and direct native signup refused; [creation policy](../../../apps/hub/src/auth/creation-policy.test.ts) verifies storage stays unchanged. |
| 1.4 Invalid, taken or reserved username refused | [Profile completion](../../../tests/e2e/complete-profile.spec.ts): server refusals retain entered details; [username checks](../../../packages/accounts/src/check-username/check-username.db.test.ts) cover the namespace. |
| 1.5 Confirm immutable username | [Profile completion](../../../tests/e2e/complete-profile.spec.ts): keyboard confirmation, warning and changed-value reset. |

## Story 2: sign in, reach a destination and sign out

| Scenario | Permanent evidence |
|---|---|
| 2.1 Internal app / external Portal | [Creation journeys](../../../tests/e2e/create-login.spec.ts): real form sign-in for both kinds; protected Portal heading. |
| 2.2 Account without workspace | [Sign-in](../../../tests/e2e/sign-in.spec.ts): account holder reaches private `/account`; anonymous direct access redirects. |
| 2.3 Master reaches STMS | [Sign-in](../../../tests/e2e/sign-in.spec.ts): native master sign-in reaches the directory. |
| 2.4 Generic invalid credentials | [Sign-in](../../../tests/e2e/sign-in.spec.ts): wrong, unknown and malformed identifiers; corrected credentials can continue. |
| 2.5 Basic identifier rate limit | [Sign-in](../../../tests/e2e/sign-in.spec.ts): repeated real refusals reach the approved limit message; [protection](../../../apps/hub/src/auth/sign-in-protection.test.ts) covers the approximate policy. |
| 2.6 Suspended refusal | [Sign-in](../../../tests/e2e/sign-in.spec.ts): specified native refusal; [coupled creation journey](../../../tests/e2e/create-login.spec.ts) suspends the same previously working login. |
| 2.7 Archived refusal | [Sign-in](../../../tests/e2e/sign-in.spec.ts): specified native refusal; [STMS](../../../tests/e2e/stms.spec.ts): actual archive and restore. |
| 2.8 Sign-out ends this device | [Creation journeys](../../../tests/e2e/create-login.spec.ts): two actual form-authenticated devices, native RP sign-out, first refused and second still authorized without renewed SSO; [sign-in](../../../tests/e2e/sign-in.spec.ts): native Hub logout actually delivers a back-channel message through the router. |
| 2.9 Return with unsaved input | [Workspace session](../../../tests/e2e/workspace-session.spec.ts): ended action/navigation, same-person reauthentication and retained mounted draft; another login cannot unlock it. [Dedicated keyboard checks](../../../tests/e2e/accessibility.spec.ts) retain the exact URL and all non-secret fields through actual popup authentication and the fresh resume handler. |

## Story 3: reset a forgotten password

| Scenario | Permanent evidence |
|---|---|
| 3.1 Old password and sessions end | [Reset control](../../../tests/e2e/reset-password.spec.ts): all target devices end, old password refused; [STMS](../../../tests/e2e/stms.spec.ts): integrated control. |
| 3.2 Ordinary new password works | [Coupled creation journey](../../../tests/e2e/create-login.spec.ts): master reset then actual form sign-in into the same workspace, without forced password change. |
| 3.3 Only masters can reset others | [Reset control](../../../tests/e2e/reset-password.spec.ts): anonymous, owner, admin and member refusals through the real action. |

## Story 4: manage own profile

| Scenario | Permanent evidence |
|---|---|
| 4.1 Required name and phone | [Profile](../../../tests/e2e/profile.spec.ts): persisted normalized details, empty-value errors and real native data. |
| 4.2 Supported square picture / circle display | [Profile](../../../tests/e2e/profile.spec.ts): JPG/PNG/WebP decoding, square crop, keyboard-selected pixels, private PNG and circular display. Hosted processor fidelity remains pending. |
| 4.3 Unsupported/oversize refusal | [Profile](../../../tests/e2e/profile.spec.ts): original byte/size checks and no crop upload; [picture boundary](../../../apps/hub/src/functions/picture.test.ts) covers hostile direct uploads. |
| 4.4 Initials when absent or removed | [Profile](../../../tests/e2e/profile.spec.ts): initial fallback, saved image and removal back to initials. |
| 4.5 Password change keeps this device only | [Profile](../../../tests/e2e/profile.spec.ts): native replacement cookie keeps current browser signed in, other device ends; [password action](../../../packages/accounts/src/change-password/change-password.test.ts) checks the old password and atomic behavior. |
| 4.6 Identifiers read-only | [Profile](../../../tests/e2e/profile.spec.ts): fields cannot be edited; [sign-in](../../../tests/e2e/sign-in.spec.ts): direct native profile/password writes remain closed. |

## Story 5: master login management

| Scenario | Permanent evidence |
|---|---|
| 5.1 Global directory fields/status | [STMS](../../../tests/e2e/stms.spec.ts): directory, paging, creation-time order and UTC display. |
| 5.2 Workspace on detail | [STMS](../../../tests/e2e/stms.spec.ts): summary/workspace projection and preserved search context. |
| 5.3 Name/email/username search | [STMS](../../../tests/e2e/stms.spec.ts): real indexed search and literal JSON-like search text; [coupled journey](../../../tests/e2e/create-login.spec.ts): saved own-profile name becomes searchable. |
| 5.4 Suspension reason, confirmation, revocation | [STMS](../../../tests/e2e/stms.spec.ts): all five reasons, required meaningful comment only for Other, confirmation and ended devices. |
| 5.5 Reactivate with existing password | [Coupled journey](../../../tests/e2e/create-login.spec.ts): same actual login/password reaches workspace after reactivation. |
| 5.6 Integrated password reset | [STMS](../../../tests/e2e/stms.spec.ts) and [reset control](../../../tests/e2e/reset-password.spec.ts): ordinary new password, native revocation and optional comments. |
| 5.7 Identifier rules/reservation/revocation | [STMS](../../../tests/e2e/stms.spec.ts): invalid/duplicate refusals, normalized email, reserved displaced username and ended sessions. |
| 5.8 Archive hides and revokes | [STMS](../../../tests/e2e/stms.spec.ts): confirmation, normal-search exclusion, refused sign-in and ended sessions. |
| 5.9 Restore previous status | [STMS](../../../tests/e2e/stms.spec.ts): active and suspended restoration via known detail address; old sessions stay ended. |
| 5.10 Non-master refused | [STMS](../../../tests/e2e/stms.spec.ts): owner/admin/member cannot open global pages; native administrative write routes also stay closed in [sign-in](../../../tests/e2e/sign-in.spec.ts). |

## Story 6: privately create a login

| Scenario | Permanent evidence |
|---|---|
| 6.1 Master creates active non-master | [Creation](../../../tests/e2e/create-login.spec.ts): standalone creation, native session role and ordinary password. |
| 6.2 Permitted creator / own workspace / kind | [Creation](../../../tests/e2e/create-login.spec.ts): owner/internal and permitted admin/external, no foreign-workspace choice; [creation policy](../../../packages/accounts/src/create-login/create-login.test.ts) refuses foreign input. |
| 6.3 Skip completed profile and forced password change | [Creation](../../../tests/e2e/create-login.spec.ts): actual sign-in reaches app/Portal using the submitted ordinary password. |
| 6.4 No permission, no write | [Creation](../../../tests/e2e/create-login.spec.ts): member refused; [backend creation](../../../packages/accounts/src/create-login/create-login.test.ts) verifies unchanged data. |
| 6.5 Tenant cannot create a master | No role selector in [creation](../../../tests/e2e/create-login.spec.ts); direct native administrative calls refused in [sign-in](../../../tests/e2e/sign-in.spec.ts); [Hub creation policy](../../../apps/hub/src/auth/create-login.test.ts) covers hostile role input. |
| 6.6 Existing identifiers preserved | [Creation](../../../tests/e2e/create-login.spec.ts): email/username/reserved conflicts and deliberate correction; [storage](../../../packages/accounts/src/create-login/create-login.db.test.ts) verifies unchanged existing records. |
| 6.7 Later save failure blocks access | [Creation](../../../tests/e2e/create-login.spec.ts): temporary SQLite audit trigger fails the actual later save, no success shown, new login cannot sign in or open profile. |
| 6.8 Same request finishes only missing steps | [Creation](../../../tests/e2e/create-login.spec.ts): remove fault, retry same reference, one login/completion/audit and original password; [backend fault cases](../../../tests/support/creation-faults.db.test.ts) cover every save boundary and workspace records. |
| 6.9 Lost success returns original result | [Creation](../../../tests/e2e/create-login.spec.ts): abort a committed reply, retain immutable request and explicitly retry; [backend](../../../packages/accounts/src/create-login/create-login.test.ts) checks saved-password preservation. |
| 6.10 Changed creator/details/permission refused | [Creation](../../../tests/e2e/create-login.spec.ts): switched actor and ended-session retry; [backend](../../../packages/accounts/src/create-login/create-login.test.ts) covers every changed reference input and revoked permission. |

## Additional boundaries

- **OIDC:** [sign-in](../../../tests/e2e/sign-in.spec.ts) checks changed state on a
  fresh unconsumed code, then succeeds with the original state/code; a separate
  consumed-code replay creates no session. The Workers
  [protocol suite](../../../apps/web/src/auth/oidc-protocol.test.ts) retains PKCE,
  nonce, issuer, exact redirect and native signing checks.
- **HTTPS/address:** customer-domain contexts reject invalid TLS certificates.
  Copying a local workspace cookie to another approved origin fails. Forged
  routing/forwarding/request-ID headers cannot choose a different workspace;
  unknown hosts use the actual Hub default.
- **Access changes:** [creation](../../../tests/e2e/create-login.spec.ts) removes
  membership through the native Organization API; the next real workspace action
  refuses access while preserving the draft. [STMS](../../../tests/e2e/stms.spec.ts)
  covers suspension/archive revocation; no old session is restored.
- **Skipped screens:** direct anonymous Portal/account access and native signup,
  profile, password, administrator, membership and client-registration write
  routes remain protected; incomplete creation/profile cannot bypass the gates.
- **Concurrent uniqueness:** actual storage races belong to the existing Workers
  username/creation suites; timing two browser clicks is not proof of atomicity.
- **Keyboard/timing:** [T042](../../../tests/e2e/accessibility.spec.ts) adds complete
  keyboard paths and axe scans for all feature screens, silent autofill/paste,
  busy/errors/confirmations and retained drafts. SC-002 uses a declared
  50 ms/10 Mbps down/2 Mbps up request link and a 3,000 ms submission-to-visible
  destination limit. SC-005 uses a 60,000 ms local keyboard-search/suspension
  limit. Shared warm Vite/workerd and substituted Turnstile are local evidence;
  hosted/cold performance and manual/inclusive accessibility remain pending.
- **Security:** [T043](../../../tests/e2e/security.spec.ts) checks actual framing
  refusal, no-referrer navigation, escaped user text, native logout confirmation
  and absence of credentials in disallowed navigation URLs/audit rows. The
  [security review](security-review.md) records the complete checklist assessment.
- **MFA follow-up:** the [T056 checkpoint](../../002-master-mfa/quickstart.md#t056-final-convergence-checkpoint)
  closes the 19 MFA scenarios alongside these original stories. Master timing
  measures the final MFA submit; credentials alone no longer complete master
  sign-in. The [T055 map](../../002-master-mfa/quickstart.md#t055-browser-acceptance-checkpoint)
  records the additional browser evidence and native fixture behavior.
- **Release:** T044's documentation reconciliation and T045's review are complete.
  The [release assessment](release-review.md) withholds deployment and first-client
  approval. Hosted/manual acceptance and the unsatisfied checklist requirements
  remain open; completing local task reviews does not satisfy them.
