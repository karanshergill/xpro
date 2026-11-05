---
paths:
  - "**/*.tsx"
  - "**/*.css"
---

# Screen conventions

Applies to what users see: pages, components and styles.

Read [DESIGN.md](../../DESIGN.md) for the visual baseline and its source
references before changing a screen.

## Components and styling

- **shadcn first:** screens use shadcn components (on Base UI) first. A
  custom component is built only when none fits.
- **Shared pieces:** components and theme tokens actually used by both apps
  live in @xpro/ui; feature-only controls stay with their app.
- **Native links:** style anchors with the shared button variants when needed;
  Base UI Button enforces button semantics and is not used for navigation links.
- **Check before updating:** before updating a component from shadcn,
  compare it with ours first, because we may have changed our copy.
- **Colours by name:** colours are used only through named design tokens,
  never raw colour values, so each workspace's branding can change them
  in one place.
- **Light and dark in tokens:** light and dark versions are defined only
  in the token definitions, never in components.
- **Variants, not overrides:** a shared component's look is changed only
  through its variants, never by overriding its styles where it is used.
- **Start and end, not left and right:** spacing and positions use start
  and end, so screens work in right-to-left languages later.
- **Hover means clickable:** hover effects appear only on things that can
  be clicked.
- **Prop names keep their meaning:** components never reuse `className`
  or `style` for anything other than their usual meaning.
- **Hook names:** hooks start with `use`, as React requires. Checked by
  the linter.
- **Event names on components:** props that react to something start
  with `on`, and the functions that handle them start with `handle`.
- **Page addresses:** page addresses are lower-case with dashes.

## Tables and lists

- **Server does the work:** business lists are sorted, filtered and
  paged on the server, and the table's state is kept in the page
  address, so a view can be shared or reloaded.
- **Pages, not endless scrolling:** admin lists use pages, never endless
  scrolling.
- **Alignment:** text is aligned to the start and numbers to the end.
- **Clear headers:** headers use plain words, with units in the header
  rather than in every cell.
- **One format:** a table shows dates and numbers in one consistent
  format.
- **Few columns first:** a table shows about five to seven columns by
  default, with a column picker for the rest.
- **Visible sorting:** the sorted column shows its direction.
- **Settings kept:** sorting and filters stay the same when moving
  between pages.
- **Bulk deletes confirmed:** deleting many records at once needs a
  confirmation or can be undone.

## Forms and fields

- **Ready before use:** JavaScript-dependent forms keep controls disabled until
  hydration and use a native POST method, so early interaction cannot lose input
  or send it through a default GET navigation.
- **Stable activation:** blur validation must not move a button during a pointer
  press. Keep keyboard blur validation and recheck every field on submission.
- **Check at the right time:** fields are checked when the user leaves
  them or submits the form, never while they are still typing.
- **Nothing lost:** a form keeps everything the user entered when it
  shows an error.
- **Errors where they belong:** each error shows next to its field, and
  submitting shows a summary. Focus moves to the first field with an
  error.
- **Never colour alone:** errors and states are shown with words or icons
  as well as colour.
- **Money and number fields:** use a text field with the decimal
  keyboard, never a number field, which silently changes what users
  type. The value is formatted when the user leaves the field, and money
  always shows its currency.
- **Date fields:** show the expected format and check the whole date,
  not its parts.
- **Date pickers:** the date picker works with plain JavaScript dates, so
  every date picker converts through our one date module at its edge and
  uses the workspace's time zone. Otherwise a user can pick the 20th and
  save the 19th.

## Text and formatting

- **Built-in formatting:** format money, numbers, dates, times and
  plurals with the platform's built-in formatting (`Intl`), in the user's
  language and time zone, not with custom code or a package.
- **Language and time zone passed:** always pass the language and time
  zone to formatting, never rely on the defaults, because the server and
  the browser can differ and the page would flicker.
- **Sorting by language:** sort text shown to users with the built-in,
  language-aware sorting (`Intl.Collator`), not plain text comparison.
- **Translated text:** every piece of text users see comes from the
  translation files. Labels that clients create themselves, such as
  custom field names, are workspace data, not translations.
- **Translation keys:** translation keys are grouped by module, then by
  screen, so each module's text can be found and translated together.
- **Room to grow:** leave room for text to grow when translated; never
  fix a width that only fits one language.
- **Languages by name:** show languages by their own name, never by a
  flag, because a flag stands for a country, not a language.
- **Fake-language check:** tests run screens in a fake language to catch
  text that skipped the translation files.

## Loading data

- **One home per data type:** each type of data has one file that owns
  its query keys and fetch functions, used by screens, loaders and tests
  alike.
- **Saves not repeated:** a failed save is never retried automatically,
  unless it is marked safe to repeat.
- **Error, loading, data:** screens handle the error first, then the
  loading state, then the data.
- **Loading shapes:** content that is loading shows a placeholder of the
  same shape, and a button that is working shows a spinner and cannot be
  pressed again; nothing on the page moves when the data arrives.
- **Old requests cancelled:** a request that a newer one replaces is
  cancelled, so old results never overwrite new ones.
- **Long lists:** lists and tables over about 150 rows render only the
  rows on screen.
- **Refresh after saving:** after a save, the related data is refreshed
  by its key prefix.
- **Clean sign-out:** signing out clears all cached data with a full page
  reload.

## Accessibility and behaviour

- **Keyboard for everything:** everything a mouse can do can also be done
  with the keyboard, with a visible focus outline.
- **Focus after changes:** after moving to another page, focus goes to
  the new page's main heading; after a delete, it goes to the next
  sensible item, never back to the top of the page. Initial page-heading focus
  uses `preventScroll`, so delayed hydration cannot move an in-progress pointer
  press to a different target. Router restoration preserves the initial document
  position and handles later client navigations.
- **Big enough to tap:** anything clickable is at least 24 by 24 pixels.
- **Errors stay:** error messages never disappear on their own; only
  success messages may fade.
- **Fits small screens:** screens work on a narrow screen without
  sideways scrolling, except wide data tables, which may scroll sideways
  inside their own area.
- **Leaving warnings:** the browser's "leave this page?" warning is used
  only while a form has unsaved changes, and removed after saving.
- **Printable documents:** documents users print, such as invoices, have
  a print layout.
- **Browser storage can fail:** reading and writing browser storage is
  always wrapped in error handling, because browsers can block it.
- **Automatic checks:** tests run an automatic accessibility check on
  every screen.
