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
