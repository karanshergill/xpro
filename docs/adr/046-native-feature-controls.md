# ADR-046: Native operational feature controls

**Status:** Accepted for local implementation | **Date:** 2026-11-03

## Problem

- **First control:** operators need to pause new personal profile-picture uploads
  or lower their file limit without changing the picture-storage implementation.
- **Authority:** availability settings must preserve existing authentication,
  MFA, profile, mounted-login and business-permission checks.
- **Scope:** later workspace, module, billing, job and Portal consumers have their
  own prerequisites in the [approved use-case map](../../specs/005-flagship/plan.md#use-case-coverage-and-prerequisites).

## Decision

- **Native boundary:** the Hub reads the Workers `FLAGS` binding through
  `getObjectValue`. Accounts owns the plain `PicturePolicy` schema and bounds;
  its upload operation receives the validated value. Core gains no flag service.
- **Contract:** `accounts_picture_policy` contains `canUpload` and `maximumBytes`.
  The limit is an integer from 1 through 2,097,152 bytes. Valibot strips unrelated
  fields and refuses invalid shapes, values and limits above the code ceiling.
- **Defaults:** the code fallback is paused. The reviewed flag definition also
  uses a paused default variation. Disabling serves that configured default;
  verify it remains paused before relying on disable as an operational stop.
- **Targeting:** use only the authenticated login ID as `targetingKey` for this
  global profile action. No membership lookup or additional Hub HTTP call is
  needed. Future workspace controls use their owning feature's trusted context.
- **Request order:** finish access checks before one evaluation per relevant page
  or upload request. Refuse a paused upload before consuming multipart input or
  accessing Images/R2. Keep request state in arguments and add no result cache.
- **Enforcement:** retain the absolute multipart bound and check the effective
  file limit at the HTTP reader and Accounts operation. Existing content checks,
  processing bounds, guarded D1/R2 saves, audit and cleanup rules remain in force.
- **Presentation:** the private profile response exposes only effective controls.
  Older responses default to paused. Check selected and cropped files, preserve
  other drafts, and refresh through the existing profile read without replaying
  uploads. Picture reads/removal and other profile operations remain usable.
- **Failures:** known native evaluation failures return the code fallback. An
  absent binding also pauses. Invalid objects and rejected evaluations use the
  existing four-field `accounts_picture_policy` diagnostic, without provider
  text, targeting data or flag values; the rest of the profile page still loads.
- **Environment:** first wire only Hub development and isolated Workers tests,
  using separate local app identifiers and `remote: false`. Hosted test/live
  apps and bindings require separate verified configuration and approval.

## Rejected options

- **OpenFeature or another client SDK now:** the native binding supplies the
  required evaluation; a second adapter adds no current capability.
- **Generic feature framework or flag administration screen:** there is one
  consuming policy. Revisit shared structure when further approved consumers
  reveal a stable need; use Cloudflare's management tools meanwhile.
- **Browser evaluation, polling or shared application cache:** duplicates policy
  state and cannot enforce an upload. Fresh server decisions remain authoritative.
- **Flags as permissions, purchased rights or quotas:** those require existing
  authorization or durable business state; a rollout setting grants none.

## Impact

- **Operation:** keep a paused configured default, target an explicit audience,
  and inspect full definitions before updates that replace rules. Retain the
  operational pause while it has an owner and a purpose.
- **Propagation:** Cloudflare documents up to 30 seconds for global changes.
  A pause affects fresh decisions and does not promise immediate revocation,
  cancellation of work already started, or reversal of a saved picture.
- **Retirement:** remove every deployed consumer or approve its permanent
  behavior before deleting a temporary flag. Review independently released
  workspace versions when future controls extend beyond the Hub.
- **Evidence:** local commands, permanent test coverage and remaining hosted
  limits are recorded in the [quickstart](../../specs/005-flagship/quickstart.md)
  and [release review](../../specs/001-sign-in-and-accounts/checklists/release-review.md).
  The existing release hold remains in force.

References: [native evaluations](https://developers.cloudflare.com/flagship/binding/methods/),
[defaults and propagation](https://developers.cloudflare.com/flagship/concepts/),
[local configuration](https://developers.cloudflare.com/flagship/configuration/)
and [management commands](https://developers.cloudflare.com/flagship/reference/wrangler-commands/).
