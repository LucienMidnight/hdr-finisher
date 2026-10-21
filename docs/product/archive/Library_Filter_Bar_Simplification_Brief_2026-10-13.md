# Codex Brief — Library Filter Bar Simplification
## HDR Finisher · Photo Library

**Date:** October 13, 2026
**Agreed with Steve:** October 13, 2026

Read `ai/AGENTS.md` first. It sets how much to test and how to report to Steve.

## Goal

The Library filter bar currently runs two filter systems side by side, and
they overlap. When this task is done there is one system: every filter lives
in exactly one place, the bar is quick and simple, and the smart album editor
is where the deep, fine-grained rules live. A filter built on the bar can
still be saved as a smart album and then refined in the editor.

## Context

Frontend only, as far as I can tell: plain JavaScript modules under
`codebase/frontend`.

- `photo-library.html` holds the filter bar (`#library-filterbar`) and the
  toolbar "RAW only" button.
- `library-filters.js` builds the "+ Filter" menu, its panels and the chips.
- `library-query.js` defines the filter fields and decides which photos match.
  It handles two shapes today: fixed properties on the filter object (search,
  rating, pick, label, type, grade, raw) and a list of rules.
- `library-smart-albums.js` is the smart album editor. `library-smart-worker.js`
  counts matches. The backend stores smart album filters in library
  preferences (`backend/hdr_finisher/library_smart_albums.py`).

What overlaps today:

| Filter | Where it appears now |
|---|---|
| Rating | Dropdown, and "+ Filter" (using the ISO range panel; its help text even says "ISO") |
| Pick status | Dropdown, and "+ Filter" |
| Colour label | Dropdown, and "+ Filter" |
| File type | Dropdown, "+ Filter", and the toolbar "RAW only" button |
| Edited or not | Dropdown called "Grade status", and "+ Filter" called "State" |
| File name | Search box, and "+ Filter" |

Also: "Match all / Match any" applies only to the "+ Filter" chips and not to
the dropdowns; clicking a chip deletes it; a chip holds one value, so two
cameras need two chips plus "Match any"; focal length, aperture and shutter
speed match one exact value only.

## Design reference

Steve approved a mock-up in conversation. In words: a single row. On the left,
four always-visible compact controls (search, stars, pick flags, colour dots).
Then a divider, then one chip per added filter, then "+ Filter". "Save as
smart album…" and "Clear" stay at the right. Match the existing Library visual
style and tokens; do not introduce a new look.

## Outcome spec

### The bar's four fixed controls

These are always visible while the filter bar is open and do not appear in
the "+ Filter" menu.

| Control | What the user can do |
|---|---|
| Search | Type part of a file name or tag, as now. |
| Rating | Click a star to mean "this many and up". Switch the comparison between "and up", "exactly" and "and below". Reach "unrated". Clicking the active star again clears it. |
| Pick status | Three toggles: picked, unmarked, rejected. Any combination. None on means no filter. Picked plus unmarked is how "hide rejected" is done; there is no separate option for it. |
| Colour label | One toggle per label colour plus "no label". Any combination. None on means no filter. |

### The "+ Filter" menu

Grouped under three headings, in this order:

| Group | Filter | Panel type |
|---|---|---|
| File | File type | Tick list, with a "RAW" shortcut at the top that ticks every RAW type present |
| File | Edited | Yes / no |
| File | Virtual copy | Yes / no |
| File | Tag | Tick list |
| Shot with | Camera | Tick list |
| Shot with | Lens | Tick list |
| Shot with | ISO | Range |
| Shot with | Focal length | Range |
| Shot with | Aperture | Range |
| Shot with | Shutter speed | Range |
| When | Capture date | Date range |

Only these panel types exist on the bar:

- **Tick list.** Values found in the photos being looked at, each with a
  count, as now. Several can be ticked. "Not recorded" / "No tags" stay
  available as values.
- **Range.** A lower and an upper end, each chosen from the values that
  actually exist in the photos being looked at, either end optional. Must
  read naturally for each field (for example "f/2.8 to f/5.6", "1/30 or
  slower"); the user should never need to know how a value is stored.
- **Date range.** From and to dates, either optional, plus a few quick picks
  (suggest: today, last 7 days, this month, this year).
- **Yes / no.**

The bar has no "is not" option, no "Match all / Match any" switch, and no
file-name rule. The word "Edited" replaces both "Grade status" and "State"
wherever a filter or its chip is named.

### Chips

- One chip per filter field. Adding a field that already has a chip edits
  that chip rather than creating a second.
- A chip names its filter in plain words ("Camera: A7 IV, A7C", "ISO 3200 or
  more"). Long tick lists must shorten sensibly rather than stretch the bar.
- Clicking the chip reopens its panel to change it. A separate × removes it.
- Keyboard use and focus behaviour stay at least as good as now.

### How filters combine

One rule, with no setting: ticks inside one filter mean "any of these";
separate filters must all match. This applies to the four fixed controls and
the chips alike.

### "RAW only"

The toolbar "RAW only" button goes away. Its job is done by the "RAW"
shortcut in File type. If something else depends on that button (a keyboard
shortcut, a saved preference, a test), tell Steve in one line what changes.

### Smart album editor

The editor keeps all of its current depth: match all or any, "is not", and
every comparison it offers today, including file-name rules.

Changes:

- It can express "is any of" for the list-type fields, so a multi-tick chip
  from the bar opens in the editor as one rule and can be edited there.
- The "Required: …" lines at the top of the editor go away. They exist only
  because the bar's dropdowns were a second system. Rating, pick status,
  colour label, file type, Edited and search arriving from the bar become
  ordinary rules like any other.
- Everything the bar can produce must open correctly in the editor, and
  "Save as smart album…" must carry the bar's current filter across exactly.
  The reverse is not required: an album using deep rules does not need to be
  editable from the bar.

When a smart album is open in the Library, the bar should not misrepresent
its rules. How the bar behaves in that case today is something you can see
and I cannot; keep the current behaviour if it is sound, and ask if the new
bar makes it awkward.

## Constraints

- One filter representation end to end. Do not keep the old fixed-property
  shape alive next to rules. The app is pre-1.0: no migration or
  compatibility code for previously saved smart albums or saved filter
  state (`ai/AGENTS.md`, "Old projects and old code").
- Because of that, smart albums saved from the old dropdowns may stop
  matching. Before finishing, look at Steve's real library preferences and
  tell him in one line how many saved smart albums are affected and which.
  Do not edit his preferences.
- Do not change what Sort offers, the grid, or anything outside filtering.
- The match count and smart album counting must stay as responsive as now on
  a large library; the counting still happens off the main thread.
- No new visual tokens or control styles beyond what the Library already
  uses, unless a control here truly has no existing equivalent. Ask first.
- Keep each file's existing line endings.

## Testing

Per `ai/AGENTS.md`: the fast checks on every change. This is Library UI and
query logic, not CPU export, Proof, or a pinned shader, so no full sweep.
Tests that cover this area include `library-query.test.js`,
`library-smart-rules.test.js`, `library-smart-worker.test.js` and
`test_library_smart_albums.py`. Tests that pin the old two-system behaviour
will need to change to the new behaviour; that is expected, and is not
loosening a check. Say which ones changed and why.

## Questions protocol

If anything here conflicts with the existing code, or a choice would change
what Steve sees beyond this brief, ask before implementing. Put questions to
Steve one at a time, in plain language, each with the trade-off and what
could break. Do not invent new patterns without checking first.

## Report back

One short note per commit. At the end: what changed for the user, which
saved smart albums are affected, what was run, and anything that failed and
why.
