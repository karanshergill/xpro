# Architecture conventions

How code is organised. Applies to all code.

## Where code lives

- **Apps and packages:** runnable apps live in `apps/`. Shared code lives
  in `packages/`.
- **One package per module:** each module, including core, is its own
  package in `packages/`. An app includes only the modules its
  workspace uses, and a client's custom modules only in that client's
  app.
- **Public interface only:** a module package exports only its public
  interface. Other code imports the package by its name, never files
  inside it.
- **Feature folders:** inside a module, everything for one action sits
  in one folder: its logic, input checks and tests. Code shared by
  several actions in the module sits beside those folders.

## Imports and boundaries

- **`#` imports:** code inside a package imports its own files with
  `#folder/...` paths, never `../` paths. Files in the same folder use
  `./`. The `#/` form is not used, because Bun cannot resolve it.
- **Framework-free business rules:** business rules never import the web
  framework, Cloudflare APIs or other outside tools. They receive what
  they need from the code that calls them.
- **Single doorways:** dates (Temporal), CSV and Excel files, and error
  reporting are used only through their one internal module, so each
  can be replaced in one place. Checked by the linter.
- **Event payloads as objects:** every event carries one object with
  named fields, so new fields can be added without breaking listeners.
- **Checked automatically:** the import rules (module boundaries, allowed
  module dependencies, framework-free business rules) are checked by a
  tool on every change, and a violation fails the check.
