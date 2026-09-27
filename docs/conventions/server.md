---
paths:
  - "**/*.server.ts"
  - "**/*.db.ts"
---

# Server conventions

Applies to code that runs on the server, including Cloudflare Workers
and Durable Objects.

## Server functions and responses

- **Server files:** server-only code lives in `.server.ts` files, which
  TanStack Start never lets into the browser bundle.
- **Thin server functions:** a server function checks its input and calls
  code in `.server.ts` files. It holds no business rules itself.
- **Two checks:** every input is checked where it enters the app, and the
  business rules check it again before saving. A bug that slips past the
  first check is caught by the second.
- **Allow-listed responses:** every response lists exactly which fields it
  returns. Whole records are never sent, so a newly added field is never
  exposed by accident.
- **API versions:** the public API carries a version number in its
  address. Breaking changes go into a new version.

## Errors, request IDs and logs

- **Error format:** every error response has a short code named after its
  module, a readable message, and the request ID. Input problems are all
  returned together, not one at a time.
- **Nothing sensitive:** error responses never include stack traces,
  internal details or personal data.
- **Request ID:** every request gets one ID at the router. It is passed to
  the workspace app and its Durable Object, and appears in every log line,
  audit entry and error for that request. Error messages shown to users
  include it, so support can find the exact request.
- **Hints, not proof:** request IDs and other details passed between our
  own workers are hints. They never prove who someone is, which
  workspace they belong to, or what they may do.
- **Structured logs:** each event is logged as one JSON line that
  includes the request ID, written to the standard output. The app never
  manages log files.

## Retries and outside calls

- **Safe retries:** every request that changes data carries a unique
  request key. The server remembers each key for a set time and answers
  a repeat with the first result instead of saving again.
- **Time limits:** every call to an outside service has a time limit and
  a planned response when it fails, so a slow service never stalls the
  app.
- **One retry rule:** a failed call, to our databases or to an outside
  service, is retried only when the error is marked temporary and the
  action is safe to repeat. Each retry waits longer, with some
  randomness. An "overloaded" error is never retried. Our request key is
  passed to outside services, so they can spot repeats too.
- **Fresh connection:** after any error, a new connection to the
  Durable Object is made, because the old one may stay broken.
- **Outside calls let others in:** while a Durable Object waits on an
  outside call, other requests can change its data. Code never checks
  something, calls outside, then saves based on the old check. Outside
  calls happen after saving, through outgoing messages, or the save
  re-checks a version number first.

## Cloudflare Workers traps

- **Memory is only a cache:** a Worker or Durable Object can stop at any
  time, losing what it holds in memory. Anything that must survive is
  saved to storage straight away.
- **No request data in shared variables:** one running copy of the code
  serves many requests, including from different workspaces in shared
  apps. Per-request data is passed through function arguments, never
  kept in file-level variables.
- **Plain data across boundaries:** data sent to a Durable Object, saved,
  queued or returned from the server is plain data. Money goes as a
  plain snapshot and dates as ISO text, then is turned back into money
  and date objects on the other side, because copying breaks money
  values and silently empties date objects.
- **Startup lock only for upgrades:** the "pause everything" lock is used
  only for the database upgrade at startup, never for normal requests or
  around outside calls, because it caps a workspace at about 200
  requests a second.

## Settings

- **Checked at startup:** settings are checked once when the app starts,
  and a missing required secret stops the release.
- **All or nothing:** an optional integration is either fully set up or
  off. Some of its settings but not all is an error that names the
  missing ones.

## Uploads

- **Our own file names:** the server builds each stored file's path from
  the workspace and a random ID. A user's file name is kept only as
  data, never used in the path.
- **Checked contents:** a file's real type is read from its first bytes,
  not trusted from its name or the browser.
- **Size limits:** uploads pass through our server, which cuts them off
  at a fixed size limit for each kind of upload.
- **Safe serving:** checked images are shown in the page, and all other
  files are sent as downloads. Private files are never cached where the
  next user could get them.

## Secrets

- **Timing-safe checks:** API keys, webhook signatures and other secrets
  are compared with the platform's timing-safe compare.
- **Crypto-only tokens:** tokens and random IDs come only from the
  platform's crypto random functions, never `Math.random`.
