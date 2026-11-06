# ADR-049: Shared test release command

**Status:** Accepted | **Date:** 2026-11-05

## Problem

- **Old command:** root deployment delegated only to Web's build and plain
  Wrangler deployment, without requiring an environment or dispatch namespace.
- **Release unit:** the prepared environment needs the Hub, private workspace
  and router, with matching resources and origins.

## Decision

- **One entrypoint:** root release, root deploy and Web deploy use one Node-hosted
  TypeScript command launched through Bun. Preview is the default; publication
  requires an explicit option. Support the reviewed test target first.
- **Platform first:** use the installed Wrangler configuration parser, dry run,
  strict deployment checks, secrets-file upload and structured deployment records.
  Select Vite's environment only for the build, inspect its flattened config
  without selecting that environment again, and verify the exact Worker name
  in each native dry-run record before publication.
- **Target checks:** require the recorded account, Worker names, resources,
  service entrypoints, origins and private dispatch namespace. Refuse unknown
  environments and overrides before starting outside commands.
- **Private values:** reuse the protected setup-file reader and prepared-receipt
  validation. Temporary secret snapshots are owner-only and removed afterward.
  Preview and receipts contain only reviewed public settings, secret names and IDs.
- **Failure:** persist the intended publication before each step and confirmed
  results afterward. Update receipts atomically. Stop on failure or an unusable
  acknowledgement and require operator inspection; do not automatically retry
  or roll back several Workers.
- **CI:** use the already selected GitHub Actions service with manual preview
  by default. Audit, typecheck, CLI/Workers tests and native preview run without
  deployment secrets. Publication requires `main`, passing checks and the
  separately configured `cloudflare-test` environment gate. It uses the same
  command and prepared-input validation, pinned tools and safe-receipt retention.
- **Boundary:** Hub SQL migrations, initial-master setup, placement publication,
  flags, production targets and CI connection keep their own reviewed steps.
  Workspace SQL upgrades remain automatic on startup. Their backward
  compatibility and any native class lifecycle changes need release review.

## Alternatives and impact

- **Plain deploy per app:** retains the wrong-target and incomplete-release risk.
- **A deployment framework:** adds unnecessary machinery for the one prepared
  target. The command coordinates the existing tools without another dependency.
- **Per-Worker hosted build triggers:** would add coordination for this ordered
  three-Worker release. GitHub Actions already matches the selected stack and
  can run the shared command without bypassing a connected Worker's identity
  guard. This does not rule out Workers Builds for other release units.
- **Automatic rollback:** cannot undo data changes or make several deployments
  atomic. Preserve known results for operator review instead.
- **Release status:** local command tests and real packaging establish local
  readiness only. The [first hosted attempt](../RELEASING.md#t064-test-attempt-2026-11-05)
  stopped after creating an unintended suffixed Hub Worker. Reviewed cleanup
  removed it, and the [corrected test publication](../RELEASING.md#t064-corrected-test-publication-2026-11-05)
  passed native receipt, provider version/binding and scoped smoke checks.
  The [protected GitHub Actions publication](../RELEASING.md#t064-verified-ci-publication-2026-11-06)
  now passes the full checks and shared command, with all three native/provider
  versions and scoped HTTP responses verified. R06 remains partial for production
  configuration; T064 and the production release hold remain open.

## Verification

- **Permanent checks:** CLI tests exercise refusals, preview, native launchers,
  private files, ordered publication, partial/uncertain results and cleanup.
- **Real tools:** all three test apps pass native build/packaging preview with
  the pinned Vite/Wrangler setup. The full type workflow checks the command
  through the CLI tests' imports. CI input tests cover matching identity, missing/
  malformed inputs, private modes, existing-file preservation and launcher privacy.
- **References:** [release runbook](../RELEASING.md),
  [Vite environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/),
  [Wrangler structured output](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/),
  [Workers Builds monorepos](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/)
  and [rollback limits](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
