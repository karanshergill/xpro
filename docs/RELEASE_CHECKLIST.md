# Release checklist

## Every release

- [ ] Before anything changes, a dry-run build of every app succeeds and the
      logged-in Cloudflare account is confirmed.
- [ ] All checks and tests pass on the Cloudflare test environment.
- [ ] Database changes only move forward, and the previous code version
      still works with the new database, so rolling back code is safe.
      Workspace data upgrades itself when new code first runs, and the shared
      database is upgraded before the release, so a rollback always puts old
      code on new data.
- [ ] The previous version to roll back to is known.
- [ ] The release order is set: the Hub on its own first, then xpro's own
      workspace once it exists, then a small group of workspaces, then
      everyone.
- [ ] The release runs through the one deploy script, the same on a laptop
      and in CI, which accepts only a named environment.
- [ ] After deploying, the live app's reported code version matches the
      version just released.
- [ ] New features are behind feature flags, switched off by default.
- [ ] Every workspace app reports its version, and STMS shows which
      workspace runs which version.
- [ ] No secrets are in git.
- [ ] Page size and speed stay within the agreed budget, checked in CI.
- [ ] Changes touching sign-in, permissions or data passed the
      [security checklist](./SECURITY_CHECKLIST.md) in code review.
- [ ] `shortcut:` comments have been reviewed.
- [ ] Release notes are written.

## Before the first real client, then after every major change

- [ ] Restoring from backup has been rehearsed.
- [ ] The heaviest expected workspace has been load tested.
- [ ] Logs are searchable, and errors can be traced to the code.
- [ ] An incident playbook is written and rehearsed: who is contacted, how
      damage is contained, and how data is restored.
- [ ] Error and uptime alerts are set up.
- [ ] Alerts fire on spikes in failed sign-ins and on permission changes.
- [ ] A `security.txt` file at `/.well-known/` tells researchers how to
      report problems.
- [ ] The Hub's master user has two-step sign-in.
- [ ] Privacy and data handling have been checked by a lawyer.
