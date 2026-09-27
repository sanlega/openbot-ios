# OpenBot design system

OpenBot's UI (`packages/ui`, shared by the desktop app and the phone PWA) is built
on one set of tokens and a small set of primitives. Use them before writing new
CSS. A live gallery of everything below renders at `/app/?design` on any running
harness (development aid; not linked from the product UI).

## Principles

- **Messenger first.** The roster and the conversation are the product; every
  other screen is secondary and reached from the sidebar.
- **Quiet by default.** Neutral surfaces, one accent color, status colors only
  where something needs attention (warning = "needs you", danger = failed or
  destructive).
- **Plain language.** No internal ids, config keys, or spec codes on screen
  ("New bots per day", not `s2_newBotsPer24h`). Bots are always shown by name
  and avatar.
- **What needs the user sits next to the composer.** Approval cards and forms
  render at the bottom of the thread; "Needs you" is visible in the roster and
  in Activity.
- **Both themes, all widths.** Every screen works in dark and light and at
  390 px phone width.

## Tokens (`packages/ui/src/styles/global.css`)

Colors are CSS custom properties on `:root`. Dark is the default; light applies
from `prefers-color-scheme: light` or `data-theme="light"` on `<html>`
(`data-theme="dark"` forces dark). Never hard-code colors in components.

| Token                                                        | Use                                         |
| ------------------------------------------------------------ | ------------------------------------------- |
| `--bg`                                                       | App background, inputs inside cards         |
| `--bg-sidebar`                                               | Sidebar                                     |
| `--surface-1`                                                | Cards, bot bubbles' containers, composer    |
| `--surface-2` / `--surface-3`                                | Hover, selected rows, secondary buttons     |
| `--border` / `--border-strong`                               | Hairlines; hovered or emphasized borders    |
| `--text` / `--text-2` / `--text-3`                           | Primary, secondary, tertiary text           |
| `--accent`, `--accent-hover`, `--accent-fg`, `--accent-soft` | Primary actions, selection, focus           |
| `--user-bubble`, `--user-bubble-fg`                          | The user's own messages                     |
| `--success(-soft)`, `--warning(-soft)`, `--danger(-soft)`    | Status: done, needs you, failed/destructive |
| `--cos`                                                      | Chief of Staff accents                      |

Scale tokens:

- **Spacing** (4 px base): `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32, `-12` 48.
- **Radii**: `--radius-xs` 6 (small controls), `--radius-sm` 8 (inputs, buttons),
  `--radius` 10 (cards), `--radius-lg` 14 (large cards, bubbles, composer), `--radius-full`.
- **Type** (Inter, bundled): `--text-xs` 11, `-sm` 12, `-base` 13, `-md` 14 (body),
  `-lg` 16 (card titles), `-xl` 20 (screen heroes), `-2xl` 28. Weights 400/500/600/650.
  Use `font-variant-numeric: tabular-nums` for times and counts.
- **Elevation**: `--shadow-1` (controls), `--shadow-2` (popovers), `--shadow-3` (dialogs).
- **Motion**: `--fast` 120 ms (hover, press), `--normal` 200 ms (expand), easing `--ease`.
  `prefers-reduced-motion` disables animation globally.
- **Focus**: `box-shadow: var(--focus)` on `:focus-visible`; never remove focus without a replacement.

## Primitives

| Primitive         | Markup                                                                                        | Notes                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Button            | `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-danger`, optional `.btn-sm` | One primary per view. Deny/cancel is ghost or secondary, not red, unless it destroys data. |
| Icon button       | `.icon-btn` with a `lucide-react` icon and `aria-label`                                       | 30 px square.                                                                              |
| Field             | `label.field` > `.field-label` + optional `.field-help` + `input`/`textarea`/`select`         | Mark optional fields, not required ones, unless most are optional.                         |
| Segmented control | `.segmented` > `button.segmented-option[role=radio][aria-checked]`                            | 2–4 short options (theme, yes/no).                                                         |
| Choice list       | `.choice-list` > `button.choice-option[role=radio                                             | checkbox]`                                                                                 | Longer options, forms. |
| Toggle            | `button.toggle[role=switch][aria-checked]`                                                    | Settings on/off.                                                                           |
| Pill              | `.pill` + `.pill-success` / `-warning` / `-danger` / `-accent` / `-muted`                     | Status only; short text.                                                                   |
| Chip              | `.chip`                                                                                       | Suggestions and quick replies (clickable).                                                 |
| Card              | `.settings-card` (+ `.settings-card-header`, `.settings-card-actions`)                        | Grouped settings and panels.                                                               |
| Row list          | `.row-list` > `.row` (`.row-main`, `.row-title`, `.row-sub`, `.row-meta`)                     | Lists of devices, engines, runs.                                                           |
| Banner            | `.banner` + `.banner-warning` / `.banner-danger`                                              | App-level status (e.g. reconnecting).                                                      |
| Screen            | `.screen` > `ScreenHeader` + `.screen-body` > `.screen-content`                               | Every secondary screen; `ScreenHeader` adds the phone Back button.                         |
| Empty state       | `.empty-state` (`.empty-title`, `.empty-text`)                                                | Say what goes here and how to get it.                                                      |
| Avatar            | `<BotAvatar bot size status />`                                                               | Stable color per bot; crown for the Chief of Staff; status dot for working / needs you.    |
| Time              | `shortTime`, `clockTime`, `dayLabel` in `components/common/time.ts`                           | Never print raw ISO or `toLocaleString()`.                                                 |

Icons come from `lucide-react` at 13–18 px. No emoji as UI icons.

## Conversation patterns (`styles/chat.css`)

- **User message**: right-aligned bubble (`--user-bubble`), time below.
- **Bot message**: full-width Markdown with avatar, name, and time; consecutive
  messages from the same author within 5 minutes are grouped (no header).
- **Handoff**: a card "Task from <Bot>" for messages another bot sent.
- **Turn steps**: a folded line "Worked for 12s · 3 steps" above the reply, a
  live "Thinking…" line while the bot works, failures open with the reason.
- **Approval card**: "Review an action", a plain headline, the command in
  monospace, details folded, and Allow once / Always allow / Deny.
- **Form card** (`ask_user`): typed fields in one card with "Send answers" and
  "Skip"; once resolved it folds into a summary. Secret fields never echo values.
- **Composer**: auto-growing textarea; Enter sends, Shift+Enter adds a line; Send
  becomes Stop while the bot works.

## Screen-specific styles

Screens may add styles for layout that belongs only to them, in their own file
and namespace: `setup.css` (`.setup-*`), `settings.css` (`.set-*`),
`screens.css` (Activity `.feed-*`/`.inbox-*`, Audit `.audit-*`, Routines
`.routine-*`/`.run-*`). Before adding a class there, check whether a primitive
already does it; if two screens need the same thing, promote it to
`components.css` and document it here.

## Checklist for a new or changed screen

1. Uses `.screen` + `ScreenHeader`, tokens, and primitives; no hard-coded colors.
2. No raw ids, keys, or spec codes; bots shown by avatar and name.
3. Has empty, loading, and error states.
4. Keyboard reachable with visible focus; icon buttons have `aria-label`.
5. Checked in dark, light, and at 390 px (screenshots in the PR).
