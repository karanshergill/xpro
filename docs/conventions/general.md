# General conventions

Applies to all code. A plain rule must be followed. "Prefer" and "avoid"
are strong defaults; breaking one needs a comment giving the reason.
Rules that a tool checks say so.

## Naming

- **Clear names:** names are meaningful, pronounceable and searchable.
  Single-letter names are used only in very short loops.
- **No magic numbers:** fixed values get a named constant instead of
  appearing as bare numbers.
- **No repeated context:** a name does not repeat what its owner's name
  already says.
- **Positive names:** true/false names state the positive case, never a
  negation.
- **One vocabulary:** business terms are defined once in the glossary and
  used with exactly that meaning in the plan, code, database and screens.
  A new term is added to the glossary before it is used.
- **Acronyms as words:** acronyms are capitalised like ordinary words,
  never in all capitals, so names read the same everywhere.
- **Capital-letter names:** all-capitals names are used only for exported
  values that never change.
- **Letter case:** variables and functions use camelCase; types, classes
  and components use PascalCase; file and folder names use kebab-case,
  except where the router requires its own file names.
- **Verbs and nouns:** functions start with a verb; values and records
  are nouns; lists and collections use plural names.
- **True/false prefixes:** true/false names start with is, has, can or
  should.
- **Events in the past tense:** events are named for what already
  happened, in the past tense.
- **Stored codes:** codes that are saved or sent outside the app, such as
  statuses, event names, error codes, permission names and audit
  actions, are lower-case with underscores and start with their module's
  name. They are never renamed once released, because saved data and
  other systems still use the old name.

## Functions

- **One job per function:** a function does one thing, at one level of
  detail, and its name says exactly what it does.
- **Few inputs:** a function takes at most two inputs. When it needs
  more, it takes one object with named fields.
- **Only what's needed:** callers provide only the inputs they actually
  use. Anything else is optional, with a sensible default.
- **No switch inputs:** a function never takes a true/false input that
  changes what it does. Each behaviour gets its own function.
- **Inputs stay untouched:** a function never changes what is passed into
  it. It returns a new value instead.
- **Side effects in one place:** saving, sending and other outside effects
  happen only in the code dedicated to them, never scattered through
  business rules.
- **Named conditions:** a condition that combines several checks gets its
  own named function.
- **Several results as an object:** a function that returns more than one
  value returns an object with named fields, not a list.
- **Always `return await`:** an async function awaits a promise before
  returning it, so the error trace keeps every step. Checked by the
  linter.
- **Top-down files:** a function sits above the functions it calls, so a
  file reads from the big picture down to the details.
- **Measure first:** code is changed for speed only after a measurement
  shows it is slow.

## Types and data

- **Types for key values:** values that carry their own rules get their
  own type, so invalid values or combinations cannot be written in code.
  Plain values without rules stay plain.
- **Simple types:** prefer plain types. Advanced type features are used
  only when a real need appears, because clever types are hard to read
  and change.
- **Every case handled:** code that behaves differently for each kind of
  value handles every kind, and TypeScript fails the build if a kind is
  missed or a new kind is added without handling it.
- **Strict code:** exported functions state their return types, and
  "this can't be empty" shortcuts (non-null assertions) are not allowed.
  The linter enforces both where it supports them.
- **Empty values:** `null` means "no value" and optional fields are left
  out. One response never mixes the two.
- **Named actions:** records change only through named actions that
  describe the business step, never by setting their fields directly.
- **Private internals:** a record's internal data is private. Other code
  reads only what the record chooses to expose.
- **Named exports:** code is exported by name, never as a default export,
  so every import uses the same name.
- **Shallow inheritance:** classes inherit at most one level. Shared
  behaviour is built by combining small parts, not by long class chains.
- **Extend, don't edit:** new behaviour is added by extending existing
  code at its planned extension points, not by editing code that already
  works.

## Comments

- **Comments explain why:** comments are written only where the reason
  behind the code is not obvious, such as a business rule or a hidden
  constraint.
- **No leftovers:** no commented-out code, no change-history comments and
  no banner lines dividing sections. Git keeps the history.

## Errors

- **Expected outcomes:** business outcomes the user can act on are
  returned as named results, which callers must handle.
- **Real failures:** only unexpected failures are thrown as errors.
- **No swallowed errors:** every caught error is handled, reported or
  re-thrown. Every promise is awaited or explicitly handled; none is left
  to fail silently.
- **One reporting path:** all error reporting goes through one internal
  function, so changing how errors are reported touches one place.

## Keeping these rules

- **Mistakes become checks:** when the same mistake happens twice, it is
  turned into a test or lint rule instead of more advice.
- **Updated with the code:** a change that alters a convention updates
  its conventions file in the same change.
- **Pull their weight:** a rule is added only if leaving it out would
  cause mistakes. Outdated or conflicting rules are removed, because the
  AI follows a short, consistent list more reliably.
