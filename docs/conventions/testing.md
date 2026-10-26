---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/e2e/**"
---

# Testing conventions

Applies to automated tests.

## What to test

- **Mostly component tests:** most tests call the app through its server
  functions with a real database. A few end-to-end tests cover each
  app's main journeys. Unit tests are only for tricky logic.
- **Five outcomes:** a test checks everything an action produces: the
  response, the new state (read back the normal way), outgoing calls and
  their content, queued messages, and log and audit entries.
- **Nothing else touched:** a test also checks that a second record, and
  another workspace, stayed unchanged.
- **Specs as tests:** every acceptance scenario in a feature spec (Given
  / When / Then) has a matching automated test with the same name. A
  feature is not done until all of them pass.
- **Bugs get tests:** every bug fix comes with a test that fails without
  the fix.
- **Every supported database:** business-rule tests run against every
  supported database: SQLite in Durable Objects now, and PostgreSQL once
  external databases arrive.

## Running and sharing tests

- **One command:** use `bun run test`, which invokes Vitest in workerd.
  `bun test` uses Bun's own runner and does not run this Workers setup.
- **Shared helpers:** tests may import `#test/...` from `tests/support/`.
  This alias belongs to the test configuration; application code never imports it.
- **Separate type checks:** application projects exclude test files. The root
  type-check command also generates test bindings and checks the test project.

## Environment and data

- **Real runtime:** tests run inside the Workers runtime with the
  Cloudflare Vitest plugin. Each workspace database is built from the
  real migrations.
- **Never live:** before any test runs, the test setup confirms it is
  connected to the local or test environment, and stops if it is not.
  Tests never run against live data.
- **Real sign-in:** tests sign in the real way. There is no test-only
  way around sign-in.
- **Own records:** each test creates the records it needs. Only fixed
  reference data is loaded once for all tests.
- **Through the real save:** each module's test helpers create records
  only through its real save functions, never by writing to the
  database directly.
- **Unique values:** values that must be unique get a short random
  ending, so tests never clash.
- **Fake data:** Faker is used only in tests, local development data and
  demo data, never in app code.
- **Coverage:** code coverage uses Istanbul, because V8 coverage does not
  work inside the Workers runtime.

The plugin isolates storage per test file. Shared setup also awaits
`reset()` after each test, so a following test starts with empty local
storage. Tests that need a schema apply the application's real migrations
before each test; there is no substitute test schema.

## Stand-ins

- **Only outside services are faked:** outside services are replaced
  with MSW for Cloudflare. Our own modules are never faked; tests use the
  real code.
- **Unexpected calls fail:** any outgoing call a test did not set up
  fails the test, including when application code catches the network error.
  Register handlers through the shared `network` from `#test/network`;
  setup enables strict MSW handling and resets handlers after each test.
- **Failures simulated:** tests cover outside services failing, being
  slow, timing out and being retried.
- **Repeats and broken jobs:** a message delivered twice has its effect
  once, and one broken job never stops the job runner.
- **Honest stand-ins:** tests never check which internal functions were
  called. Stand-ins are set up in the test file itself, reset before
  each test, and typed to match the real thing.

## Names and checks

- **One idea per test:** each test checks one behaviour, and its name says
  which, so a failing test points straight at the problem.
- **"When ... then ..." names:** test names describe the situation and
  the expected result, and tests are grouped by the action they cover.
- **Whole results:** a test compares the whole result it expects, not a
  few picked fields, so unexpected changes are caught.
- **Named results:** compare true-myth results through `.toJSON()`. Its
  `.inspect()` method conflicts with the current runner's failure printer;
  comparing plain data keeps assertion failures readable.
