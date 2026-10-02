# Quickstart: Sign-in and Accounts

## Prepare

1. `bun install`
2. Start the Hub, the workspace app and the router, each with its own dev command, over https on
   `*.localhost`.

## Prove it with tests

- Run the API tests with one command. Each acceptance scenario in the spec has a matching test
  named after it ("when … then …").

## Try it by hand

1. Sign up at the Hub and finish the first sign-in (username, name, phone).
2. Change the profile and the password.
3. As the master user, suspend the person.
4. Confirm the person is signed out of the workspace at their next action.

See [data-model.md](./data-model.md) and [contracts/server-functions.md](./contracts/server-functions.md)
for details.
