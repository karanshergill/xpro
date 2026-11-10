# Provisioning Contract

- **Feature:** [STMS account and workspace management](../spec.md).

| Operation | Input | Result |
|---|---|---|
| `requestWorkspaceCreation` | Stable operation ID, account ID/revision, workspace name and permitted region hint | Creation ID, workspace ID and progress; no credentials |
| `resumeWorkspaceCreation` | Stable operation ID, creation ID and expected attempt revision | Current or newly claimed attempt and progress |
| Private `startProvisioning` | Creation ID and attempt revision | The matching Workflow instance reference |
| Private checkpoint/activation calls | Creation ID, attempt revision and a validated stage receipt | Accepted, already recorded, superseded or needs attention |

- **Request boundary:** Hub authenticates each operator request. Native client preparation happens in that authenticated Hub operation before Workflow dispatch; browser cookies are never stored in the Workflow.
- **Stable start:** save intent first. A repeated start or lost Workflow-create reply resolves the same attempt ID rather than launching independent work.
- **Artifact verification:** accept only an approved immutable release. Validate its manifest and file hashes; no browser-supplied source or arbitrary download URL.
- **Upload:** follow the documented assets-upload and multipart Worker-upload APIs. Apply only the recorded target, bindings, compatibility settings and Durable Object migration metadata.
- **Readback:** compare the deployed Worker with the recorded allocation and release. Unexpected pre-existing resources or configuration drift cause Needs attention, not an overwrite.
- **Private initialization:** use a dispatch-supplied setup context, following the existing private workspace-user pattern. HTTP headers or bodies cannot supply setup authority.
- **Owner preparation:** initialize the correct workspace identity and internal user, then return a non-secret receipt. A stale holder receipt cannot authorize completion.
- **Activation:** Hub verifies the current attempt, actor authority, holder, tenant status and receipts. One guarded batch establishes membership, placement, address, completion and audit.
- **Cache publication:** publish routing cache data only after that commit. A cache failure does not manufacture or revoke authorization.
- **Retries:** override default Workflow retries for non-idempotent writes. Retry only after reconciliation proves the operation safe; otherwise stop at Needs attention.
- **Resume:** a new authorized attempt may reuse verified resources, but obsolete attempts cannot checkpoint or activate.
- **Boundary:** no public route to the executor, no automatic destructive cleanup, and no new resource or configuration changes without separate approval.

## Sources

- [Asset deployment](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/static-assets/).
- [Upload metadata](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/).
- [Workflow retries](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/).

## Artifact delivery and environment

- Store approved, prebuilt workspace releases in a dedicated private R2 bucket, separate from profile pictures. Release tooling writes the artifacts; the platform Worker reads them through its binding.
- A versioned manifest identifies the release, main module, module and asset objects, sizes and hashes, native upload metadata, compatibility settings, required binding names and access protocol version. It contains no credentials.
- Creation records pin one approved release. Resuming never silently switches builds. Verify the manifest and object integrity before deployment; do not accept caller-supplied URLs or source.
- Keep provider credentials in the private platform Worker. Restrict operations to the configured Cloudflare account and dispatch namespace, with bounded calls and safe failure codes.
- Use a configured, owned test base domain for distinct workspace origins, routed through the dispatcher. A single workers.dev hostname is not a substitute for multiple isolated origins.
- Proposed test resources are xpro-platform-test, the xpro-workspace-provisioning-test Workflow and the xpro-workspace-releases-test bucket. The existing xpro-workspaces-test dispatch namespace remains the target.
- Extend the guarded release path only through separately approved configuration changes. Preserve the existing three Worker identities and their checks; do not add arbitrary-target or force bypasses.
- Retain artifacts referenced by unfinished or deployed workspaces. This feature adds no automatic artifact deletion.
- These are design choices, not approval to create resources, configure DNS, issue tokens or publish.
