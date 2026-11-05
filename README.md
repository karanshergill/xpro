# xpro

A multi-tenant, modular business platform on Cloudflare Workers.

## Layout

- `apps/web`: workspace app (TanStack Start on Cloudflare Workers)
- `apps/hub`: central identity and platform app
- `apps/router`: workspace-address routing
- `packages/`: shared Core, Accounts, STMS and UI code
- `docs/`: planning and tech stack
- `.specify/memory/constitution.md`: the project constitution, the permanent rules everything follows
- `.specify/`: Spec Kit templates and scripts
- `specs/`: feature specifications

## Develop

Use Bun and Node.js. First verify the checkout from the repository root:

```bash
bun install --frozen-lockfile
bun run test
bun run build:all
bun run typecheck
```

The sign-in and account-management backend, profile-completion, Hub sign-in,
create-login and own-profile screens, workspace session return and master login
management are implemented. The Hub's `/profile` page edits personal details,
crops private pictures and changes the current person's password. Masters complete
authenticator enrollment or second-factor verification before protected access,
and manage their authenticator and backup codes from Profile. They use
`/stms/logins` to search and manage logins, including password resets. See the
[sign-in baseline](specs/001-sign-in-and-accounts/tasks.md#t045-release-review-checkpoint)
and [MFA checkpoint](specs/002-master-mfa/quickstart.md#t056-final-convergence-checkpoint).

Local profile-picture uploads use a native Flagship policy for availability and
file limits. Uploads stay paused until a valid policy targets the login; current
pictures remain viewable/removable. Prepare the [local control](specs/005-flagship/quickstart.md)
before starting the Hub when uploads are needed.

[Isolated browser checks](specs/001-sign-in-and-accounts/quickstart.md#browser-checks)
connect all six stories with native authentication, trusted customer-domain HTTPS,
local router dispatch and actual back-channel logout. The
[acceptance map](specs/001-sign-in-and-accounts/checklists/browser-acceptance.md)
records the evidence and limits. The
[security review](specs/001-sign-in-and-accounts/checklists/security-review.md)
records local protections and remaining privacy/release requirements.
[Dedicated keyboard and timing checks](specs/001-sign-in-and-accounts/quickstart.md#t042-keyboard-and-performance-checks)
also run locally. The
[hosted T063 checkpoint](specs/004-cloudflare-test/quickstart.md#hosted-verification-t063)
records real sign-in/MFA, private workspace dispatch and staff creation, session
revocation, picture controls, collector privacy and a received native test alert.
Its image checks cover selected synthetic PNG cases. Production performance,
operations and the remaining requirements stay in the
[release review](specs/001-sign-in-and-accounts/checklists/release-review.md);
production deployment and first-real-client approval remain withheld.

Tests run locally in the Workers runtime. For development, follow the
[HTTPS and private-settings setup](specs/001-sign-in-and-accounts/quickstart.md#prepare),
then start each app in its own terminal:

| App | Command | Address |
|---|---|---|
| Hub | `bun run dev:hub` | `https://hub.localhost:3001` |
| Workspace | `bun run dev` | `https://web.localhost:3000` |
| Router | `bun run dev:router` | `https://router.localhost:3002` |

Routing uses prepared workspace addresses and OAuth settings. The local router
supports one prepared workspace app; production routing targets Workers for Platforms.
The next task is the
[T064 readiness review](specs/005-flagship/tasks.md#live-readiness-review-t064),
using the existing [release requirements](specs/001-sign-in-and-accounts/checklists/release-review.md).

## Build and deploy

The root `build` targets `apps/web`; `build:all` builds all three apps locally,
including a router dry run. Use `bun run release --env test` to build, check and
package the complete prepared test environment without deploying it. Root
`deploy` and Web's `deploy` alias use that same guarded command. Publication
requires `--publish`, protected prepared settings and separate deployment
approval. See [Releasing xpro](docs/RELEASING.md) for the preview, ordering,
receipts and failure procedure. Production targets remain part of T064.
