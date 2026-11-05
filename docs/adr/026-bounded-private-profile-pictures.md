# ADR-026: Process private profile pictures through the Images binding

**Status:** Accepted | **Date:** 2026-10-29

## Problem

- **Images:** accept small JPEG, PNG and WebP uploads, create square output and
  remove camera/location metadata in the Workers runtime.
- **Storage:** R2 holds the private file and D1 holds its key. These stores cannot
  share a transaction; preserving a usable picture needs a scoped save exception.

## Decision

- **Processor:** use Cloudflare's Images binding, once per upload. Check actual
  signatures and decode with the service; never trust a file name or MIME claim.
  Limit each file to 2 MiB and the streamed multipart body to that plus 64 KiB.
- **Output:** PNG, still frame, central square with side equal to the smaller
  source dimension, capped at 512 pixels without upscaling. Cloudflare discards
  all metadata for PNG output. Bound the output to 2 MiB and processing to ten
  seconds. Only returned output may reach storage; late processing cannot save.
- **Authority:** reuse the Hub's exact-Origin POST and live own-profile access
  checks. Upload uses multipart POST at `/api/v1/profile-pictures`; removal uses
  a registered JSON POST server function. Neither accepts a login ID or key.
- **Replacement:** stage a generated `profiles/<loginId>/<uuidv7>.png` R2 object,
  then use one indexed D1 update guarded by the previously read key. A concurrent
  winner returns `accounts_picture_changed`; discard the losing staged object.
  Never delete a key outside the affected login's prefix.
- **Scoped save exception:** preserve the previous key/object until the D1 save
  commits. After a lost reply, read back without repeating the write. A confirmed
  new key is success. If confirmation is unavailable, keep both private files and
  return a safe error; the pointer may already have changed.
- **Removal:** clear the pointer before deleting the previous object. An absent
  picture succeeds without a write. Confirm an uncertain removal by reading back.
- **Cleanup limit:** after a committed replacement/removal, failed old-object
  deletion logs one safe event and leaves the change successful. A stopped
  Worker or failed staged cleanup can also leave an unreferenced private object.
  No queue, cleanup ledger or automatic write retry is added. Add a cleanup job
  when storage usage or a strict deletion/retention requirement warrants it.
  This exception does not relax other STMS save/audit guarantees.
- **Configuration:** propose `IMAGES` in the Hub, its local environment and the
  test Worker, with local remote access disabled. No dependency or paid-plan
  purchase is required by this change. Hosted image transformations still need
  reviewed account setup and quota checks before deployment.
- **Quota:** free-plan transformations have a monthly allowance and reject new
  transformations above it. Treat quota/service failures as safe unexpected
  errors while preserving the previous picture.

## Alternatives rejected

- **Store originals:** fails square-output and metadata-removal requirements.
- **A Node image package in production:** adds a dependency whose native runtime
  does not run on Workers.
- **A separate image server or recovery system:** adds operating work beyond the
  initial requirement; the native binding and private-orphan limit suffice.

## Verification and limits

- **Local:** actual binding output is inspected for PNG dimensions and metadata;
  real authentication, D1 and R2 cover ownership, races and failure recovery.
- **Simulator:** installed local tooling has limited transformation fidelity.
  Its corrupt JPEG metadata failure can be an uncoded 500 rather than the
  documented invalid-image code. Keep that failure safe; do not parse native
  error text or patch the simulator. Typed outside-service cases verify the
  documented invalid/unsupported-image codes.
- **Hosted:** full-fidelity cropping, orientation, animation and corrupt-input
  behavior require staging checks. T034 supplies crop interaction, picture
  serving, circular display and initials. Local checks do not prove these.

## References

- [Images bindings and local development](https://developers.cloudflare.com/images/optimization/binding/)
- [Output formats and metadata](https://developers.cloudflare.com/images/optimization/features/#metadata)
- [Transformation errors](https://developers.cloudflare.com/images/reference/troubleshooting/)
- [Images pricing and free quota](https://developers.cloudflare.com/images/pricing/)
