# Security checklist

Checked in code review for every change that touches sign-in, permissions or data.

- [ ] **Signed in is not allowed:** every request re-checks that the user is still
      an active user of this workspace, with the right role.
- [ ] **Bounded input:** every server function that takes data checks it with
      limits on lengths, sizes and counts, not only on types.
- [ ] **Only what's needed:** responses carry only the fields the screen uses,
      never whole database records.
- [ ] **Nothing secret in logs:** no passwords, session cookies, sign-in headers,
      API keys, database addresses or personal data that is not needed.
- [ ] **Safe redirects:** after sign-in, users are only sent to our own pages,
      never to an address taken from the request as it is.
- [ ] **No user HTML:** HTML written by users is never displayed.
- [ ] **No secrets in the browser:** session data and other secrets are never
      kept in the browser's local storage.
- [ ] **Requests from our own pages:** every request that changes data checks
      it came from our own pages, so other sites cannot send it on a user's
      behalf.
- [ ] **No framing:** other sites cannot show our pages inside theirs.
- [ ] **Security headers:** every response carries the agreed security
      headers.
- [ ] **Clean uploads:** location and camera details are removed from uploaded
      pictures.
- [ ] **Private source maps:** source maps go to error reporting only, never to
      the public.
- [ ] **Safe patterns:** no search pattern is built from user input, and none
      has nested repetition that could freeze the server.

## Privacy

- [ ] **Only needed data:** only personal data a feature really needs is
      collected.
- [ ] **Deletion requests:** people ask for their account to be deleted with a
      button in their profile settings. Only the master user, or xpro staff
      given that permission, reviews and carries out the request.
- [ ] **Anonymised, not deleted:** carrying out a request replaces the
      person's personal details, so records and the audit log stay whole.
      The action is recorded in the audit log.
- [ ] **No personal details in audit entries:** audit entries refer to
      people by their login ID only.
- [ ] **Retention stated:** how long each kind of personal data is kept is
      written down.
