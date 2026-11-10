---
version: alpha
name: xpro
description: The current visual baseline and guidance for extending xpro screens.
---

# xpro design

## Overview

xpro's current interface presents a named task, its fields or records, and its
actions in a clear reading order. It uses a restrained blue-grey palette, system
type, rounded controls and bordered sections. Headings, spacing and alignment
provide the hierarchy.

This guide describes the existing interface and accepted conventions. Read it
alongside [screen conventions](docs/conventions/screens.md) and
[ADR-008](docs/adr/008-ui-kit-shadcn-base-ui.md) before changing a screen.
The [shared stylesheet](packages/ui/src/styles.css) owns exact theme values;
component implementations own their variants and dimensions. Token values are
kept there rather than duplicated in this document.

The Hub currently contains sign-in, MFA, profile and login-management screens.
Workspace and Portal routes currently provide minimal shells. Their broader
navigation, business dashboards and workspace branding controls remain design
work for their owning features; this guide does not define those layouts.

## Colors

Use the semantic roles in the shared stylesheet through their named utilities.
The light theme uses pale surfaces and dark text; the dark theme reverses that
relationship. The implemented theme follows `prefers-color-scheme`.

| Token | Role |
| --- | --- |
| `background` | Page canvas and input background. |
| `foreground` | Main text and default foreground. |
| `card` | Form sections and dialog surfaces. |
| `muted` | Supporting surfaces, placeholders and avatar fallback. |
| `muted-foreground` | Descriptions, captions and secondary text. |
| `primary` / `primary-foreground` | Filled actions and their text. |
| `border` | Section boundaries and table dividers. |
| `input` | Input boundaries. |
| `ring` | Keyboard focus indicators. |
| `destructive` | Error text and error boundaries. |

Keep light/dark changes in token definitions, so components retain the same
roles. Express statuses in words as well as any colour. A shared success or
warning palette is not currently defined; additional semantic roles need a
reviewed token change with the feature that uses them.

## Typography

The shared `font-sans` stack is `ui-sans-serif, system-ui, sans-serif`. Both apps
import it from the shared stylesheet.

| Use | Existing treatment |
| --- | --- |
| Page heading | `text-2xl font-semibold`. |
| Form-section or dialog heading | `text-xl font-semibold`. |
| Labels | `text-sm font-medium leading-6`. |
| Descriptions and captions | `text-sm`, usually with `text-muted-foreground`. |
| Inputs | `text-base`. |
| Table content | `text-sm`. |

Use semantic headings in reading order. Give identifiers and long text room to
wrap where needed. Text, dates and numbers follow the translation, language and
time-zone rules in the screen conventions; layout must accommodate longer
translations and right-to-left text.

## Layout

Existing page shells are centred, full width up to a task-specific maximum,
with `px-4` side padding and larger vertical spacing on wider screens.

| Screen | Existing source and width |
| --- | --- |
| Sign-in and MFA | [SignInShell](apps/hub/src/features/sign-in/sign-in-screen.tsx) and [MfaShell](apps/hub/src/features/mfa/mfa-screen.tsx), `max-w-lg`. |
| Profile | [ProfileShell](apps/hub/src/features/profile/profile-screen.tsx), `max-w-2xl`. |
| Login management | [StmsShell](apps/hub/src/features/stms/management-ui.tsx), `max-w-6xl`. |

Group related fields and actions together. Existing field groups use `gap-6`;
action rows wrap with `gap-3`. Sections commonly use `p-5` with increased padding
at larger breakpoints. Reuse the appropriate existing shell and component
spacing when extending that screen.

Keep navigation and action rows usable at narrow widths. Place wide tables in
their own horizontally scrollable region. Use logical start/end alignment and
spacing so the layout can follow text direction.

## Elevation & Depth

Borders, surface colour and spacing separate most content. Sign-in/MFA cards
use `shadow-sm`. The shared alert dialog uses `shadow-lg` and a translucent
`bg-foreground/25` backdrop to distinguish a blocking interaction. Reuse those
component treatments for the same interaction rather than adding local effects.

## Shapes

| Element | Existing treatment |
| --- | --- |
| Buttons and inputs | `rounded-lg`. |
| Profile sections and table regions | `rounded-xl`. |
| Sign-in/MFA cards and shared alert dialogs | `rounded-2xl`. |
| Saved profile picture or initials | `rounded-full`. |

The shared button and Hub input have `min-h-11`. Preserve their control size
and visible focus state. The screen conventions set the minimum click target
for other interactive elements.

## Components

- **Reuse:** follow the accepted shadcn/Base UI foundation. Shared components
  actually used by both apps live in [@xpro/ui](packages/ui/src/); feature-only
  controls stay with their app. Change shared appearances through variants.
- **Actions:** use the shared [Button](packages/ui/src/button.tsx): its default
  variant is filled and its outline variant is secondary. Navigation uses
  anchors, with shared button variants where appropriate.
  Button foreground and surface colours change together without interpolation,
  avoiding low-contrast intermediate frames when the action variant changes.
- **Forms:** follow the existing [fields](apps/hub/src/components/ui/field.tsx)
  and [inputs](apps/hub/src/components/ui/input.tsx). Keep visible labels,
  descriptions and field errors. Validate on blur or submit; focus the first
  invalid field and retain entered values when submission fails.
- **Tables:** follow the [login list](apps/hub/src/features/stms/login-list.tsx):
  a named search, headers, readable status labels, visible sort order and page
  navigation. Keep the empty state distinct from a failed or loading request.
- **Feedback:** preserve layout while loading. Disable busy actions, show their
  progress and provide readable success or error messages. Include the request
  reference when the operation supplies one; never silently repeat a save.
- **Dialogs:** use the shared [AlertDialog](packages/ui/src/alert-dialog.tsx)
  for existing blocking confirmation and access-recovery patterns. Preserve its
  title, description, keyboard focus and explicit next actions.

## Do's and Don'ts

- **Do** preserve keyboard operation, visible focus and sensible focus after
  navigation or validation. Keep the initial page heading from moving the
  scroll position when hydration finishes.
- **Do** keep forms usable through hydration, loading, validation and session
  changes, following the existing screen and security behaviour.
- **Do** respect the shared reduced-motion preference and test narrow layouts,
  both colour schemes, longer translations and right-to-left text.
- **Don't** put raw colour values or light/dark overrides in feature components.
- **Don't** move a submit action during pointer activation or discard another
  form's draft when showing an error.
- **Don't** present a planned layout or component as already implemented.
- **Maintenance:** when an approved theme or component change alters this
  baseline, update its code and this guide together. Read linked implementations
  for current values, and verify the affected screen through the project's
  existing browser and accessibility checks.
