# Release checklist

## Every release

- [ ] All checks and tests pass on the Cloudflare test environment.
- [ ] Database changes only move forward, and the previous code version
      still works with the new database, so rolling back code is safe.
- [ ] The previous version to roll back to is known.
- [ ] The release order is set: xpro's own workspace first, then a small
      group of workspaces, then everyone.
- [ ] New features are behind feature flags, switched off by default.
- [ ] Every workspace app reports its version, and STMS shows which
      workspace runs which version.
- [ ] No secrets are in git.
- [ ] `shortcut:` comments have been reviewed.
- [ ] Release notes are written.

## Before the first real client, then after every major change

- [ ] Restoring from backup has been rehearsed.
- [ ] The heaviest expected workspace has been load tested.
- [ ] Logs are searchable, and errors can be traced to the code.
