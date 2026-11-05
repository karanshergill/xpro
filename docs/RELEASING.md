# Releasing xpro

The shared release command currently supports only the existing, initialized
Cloudflare `test` environment. Production release remains blocked by the
[release review](../specs/001-sign-in-and-accounts/checklists/release-review.md).

## Preview

From the repository root, with Bun, Node.js and the installed dependencies:

```bash
bun run release --env test
```

This builds the Hub and workspace with `CLOUDFLARE_ENV=test`, checks the generated
configurations against the approved test resources and packages all three apps
with Wrangler's native dry run. Only the Vite build steps receive
`CLOUDFLARE_ENV=test`; Wrangler reads the flattened Hub/workspace configurations
without applying that environment again. The router uses its named test
configuration. Each native dry-run record must identify the exact intended
Worker and contain no live version ID before authentication or publication starts.
It needs no operator secrets or Cloudflare authentication and performs no
deployment. A successful result has `status: "checked"` and an ordered `plan`
listing the account, Worker names, configuration paths, resource bindings,
private dispatch namespace and required secret names.

The root `deploy` command and the Web package's `deploy` alias delegate to this
same entrypoint. A missing, duplicate or unsupported environment is refused.
Worker/account/resource overrides are not accepted. `production` is refused
until its target and configuration are separately implemented and reviewed.

## Publish the prepared test target

Review the preview, intended source and exact remote actions first. Keep the
successful [T063 initialization](../specs/004-cloudflare-test/quickstart.md#hosted-verification-t063)
and its protected `.cloudflare-test.local/` files available. The directory must
be owner-only, with regular owner-only `prepared.json`, `hub.json` and
`workspace.json` files. Use the existing authenticated Wrangler identity or an
approved CI identity that can access the recorded account and resources.

After deployment approval:

```bash
bun run release --env test --publish
```

The command repeats local build/packaging checks, verifies account membership,
validates the prepared identity and secret files, then deploys in this order:

1. `xpro-hub-test`.
2. Private `xpro-test` in `xpro-workspaces-test`.
3. `xpro-router-test`.

Native strict deployment checks remain enabled. Publication records each returned
Worker version/deployment ID in an owner-only
`.cloudflare-test.local/release-<id>.json` receipt, including the intended action
before it starts. The command preserves the default `xpro` name and existing
Worker/runtime settings. Hub SQL migrations, resource provisioning, login/client
initialization, placement publication and feature activation remain separate
reviewed steps. Workspace SQL upgrades still run on startup as designed; review
their backward compatibility and any native Durable Object class lifecycle
changes before publishing.

## Failure and cleanup

A failure stops subsequent steps and returns `status: "failed"` with its `stage`
and confirmed deployment IDs. An attempted publication may have reached
Cloudflare even when no usable acknowledgement was returned. Inspect the private
receipt and provider state before retrying; no automatic replay or rollback runs.
An interrupted receipt may remain `publishing`; treat that as requiring review.

Receipts are updated atomically and contain safe identifiers and secret names.
The command captures child output privately and removes its temporary bundles,
Wrangler logs and secret snapshots after success or failure. It reports safe
stage summaries rather than raw provider errors or credentials. Original
operator files and release receipts remain in place.

## T064 test attempt: 2026-11-05

The first controlled command publication stopped at `publish_hub` after creating
`xpro-hub-test-test`, version `1d4d599c-06fc-4c0a-b5f5-c5d7f63a12aa`.
The command also passed its build selector, `CLOUDFLARE_ENV=test`, to Wrangler,
which selected the environment again when reading the explicit flattened Hub
configuration. The returned Worker name failed the acknowledgement check, so
workspace and router publication did not run.

At that failed checkpoint, provider readback confirmed the intended Hub, private
workspace and router versions, bindings, workspace Durable Object namespace and
disabled/paused picture policy were unchanged. An empty confirmed-deployments list in a failed
receipt therefore does not establish that no remote resource was created.
Inspect provider state and review cleanup before retrying.

The targeting correction and native packaging guard pass local CLI tests and
real three-app packaging. Reviewed cleanup removed the unintended Worker and
verified its absence. First-attempt evidence remains in
`.cloudflare-test.local/t064-test-publication.json` and the command's
`release-0a836967-b43d-41b3-bdea-edb7736b32c8.json` receipt.

## T064 corrected test publication: 2026-11-05

The approved retry of `bun run release --env test --publish` completed in the
reviewed Hub, private workspace, router order. Native receipts and Cloudflare
readback matched these versions:

| Worker | Published version |
|---|---|
| `xpro-hub-test` | `d5bd017b-01fd-4acc-8570-c0c9b7158fb6` |
| `xpro-test` | `4ae66804-151a-4b64-90e1-25630475134b` |
| `xpro-router-test` | `2e079b04-c2db-46af-b1f4-6aa7c7601e69` |

`xpro-test` remains private in `xpro-workspaces-test`. Cloudflare's compact
workspace deployment ID matches its native UUID above after removing hyphens.
The public Workers each serve their recorded version at 100%. Readback verified
all three Workers' bindings, runtime/privacy settings, existing workspace Durable
Object namespace and the disabled/paused picture policy. The unintended
`xpro-hub-test-test` Worker remained absent.

Smoke checks passed with no-store caching and frame-denial headers:

- Hub `/sign-in`: HTML 200.
- Workspace browser navigation: 302 to its `/auth/start`.
- Workspace API request without a session: 401.

Authenticated-journey evidence remains the separate
[T063 checkpoint](../specs/004-cloudflare-test/quickstart.md#hosted-verification-t063).
This publication check covered provider readback and the three responses above.
The native receipt is
`.cloudflare-test.local/release-f1b25e13-2a30-4246-b38a-f47b389c8a38.json`;
`.cloudflare-test.local/t064-corrected-test-publication.json` records the before/
after readbacks, preserved storage identity and cleanup. Disposable source,
builds, logs and copied secrets were removed; original operator files remain.
CI verification and production configuration/readiness remain outstanding.
R06 stays partial and T064 remains open.

## Verification and remaining gates

`bun run test:cli` covers target refusals, actual Bun/Node launchers, private-file
checks, deployment order, uncertain outcomes and cleanup using synthetic operator
files and stand-ins for external tools. The real preview also packages all three
apps locally. Neither check proves remote publication, production behavior or CI.
Run the same entrypoint from the chosen CI runner when that connection is approved.

Forward migrations, an old/new code compatibility rehearsal, rollback artifacts,
version reporting, production configuration and the remaining T064 requirements
are separate work. Code rollback does not restore the databases or picture objects.

References: [Vite environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/),
[Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy),
[native structured output](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/)
and [rollback limits](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
