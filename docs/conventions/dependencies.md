---
paths:
  - "**/package.json"
  - "bun.lock"
  - "bunfig.toml"
  - ".github/**"
---

# Dependency conventions

Applies to adding, updating and checking outside packages and tools.

## Adding

- **Steps first:** before adding a package, follow the steps in AGENTS.md
  (official docs, Cloudflare Workers support, platform first).
- **Listed before used:** a new package is added to the tech stack list,
  with what it is for, in the same change that adds it.
- **Own types first:** prefer packages that ship their own types. Add a
  separate types package only when there is none, with the same major
  and minor version as the package, and never add an outdated stub.

## Versions

- **Exact versions:** every package is pinned to an exact version, never
  a range or "latest", so every install gets the same code.
- **Waiting period:** new versions are installed only after they have
  been public for a few days, because harmful releases are usually
  caught and removed within that time.
- **Lockfile is the truth:** the lockfile is always committed, and
  automatic checks install from it without changing it.
- **Install scripts off:** packages' install scripts do not run, unless
  the package is listed as trusted, with the reason written down.
- **Actions by commit:** GitHub Actions are pinned to a full commit ID,
  with the version written beside it as a comment.

## Updates and checks

- **Weekly updates:** Dependabot suggests updates weekly, grouped
  together; read the release notes before accepting a major version.
- **Known problems fail the check:** `bun audit` runs in the automatic
  checks and fails on serious known vulnerabilities.
