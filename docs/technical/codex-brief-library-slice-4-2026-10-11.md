# Codex Brief — Photo Library Slice 4: Compare and Overlays
## HDR Finisher

**Date:** October 11, 2026
**Branch:** `photo-library` only. Check with `git branch --show-current`
before changing anything.
**Start after** the slice 3 leftovers brief is finished and committed.
**Read first:** `AGENTS.md`, then `docs/technical/photo-library.md`
(sections 8 and 9, and the slice 3 Stage B notes on kept pictures), then
these parts of `docs/product/Photo_Library_PRD_2026-10-09.md`: sections
3, 5.3, 5.9, 5.10, 5.11 and the "Later on October 11" decisions in
section 4. The mock-up in `docs/product/library-wireframes` shows
compare, both overlays, their option panels and the legend. Where this
brief and those pages disagree, ask.

## Goal

Steve can pick the best frame of a run quickly. He pins one photo, flips
through the alternatives beside it with zoom and position locked
together, and marks them without leaving the view. A focus overlay shows
where each photo is sharp, and an exposure overlay shows what is blown
or blocked, on thumbnails as well as on the large photo, without zooming
in on each one.

## Context

- The Library already has grid, filmstrip, single view, full-screen
  review, native 100% zoom with drag to pan, and a live HDR switch. Zoom
  and position are kept while flipping between photos in single view.
- Unedited photos are drawn from a reduced quick scene picture, with a
  full quick decode only for 100% zoom. Edited photos show a kept
  picture of their saved grade, enlarged when zoomed; the original is
  not decoded.
- Library work runs in the low-priority helper and gives way to Grade,
  export and pictures for the screen. The backend is the only writer.
- Pictures live in the app's cache area under one storage limit. Nothing
  is written beside photos except settings files.
- Steve is not a coder. He judges this by culling real shoots.

## Decisions already made (do not reopen)

- Single click navigates; double-click on a thumbnail opens in Grade.
  Browsing, comparing and overlays never change a grade and never
  prompt.
- **A key is the quick switch; a click opens the options.** Clicking
  Focus, Exposure or Compare on the toolbar opens a small panel, in the
  same pattern as Overlays, Preview and Frame on the Grade stage. The
  panel holds the on/off switch and the settings. S, E and C are the
  instant on/off.
- **One focus overlay, with a strength slider that behaves like focus
  peaking in a camera** (Steve, October 11).
- Overlay maps record where, not what colour. Colour and strength are
  applied when drawing, so changing them never re-makes a map.
- Option-panel settings are remembered between launches. Whether an
  overlay or compare is switched on is not remembered.
- Overlay first. No sharpness score, and no sorting by sharpness.

## Outcome spec

Work in four stages. Each ends with the app usable, the fast checks
passing and a short plain report to Steve.

### Stage A — two small fixes found by reading the code

Neither has been run or confirmed. Investigate, confirm, then fix; if
either is not real, say so and move on.

- **A photo becomes "Edited" because an overlay was switched on.** The
  Grade overlay view settings (zebra, false colour, opacity, threshold)
  appear to be stored inside the grade and to count when the Library
  decides whether a photo is edited. Looking at a photo with an overlay
  and saving must not mark it Edited, must not make a new kept picture,
  and must not count as a difference for reverts.
- **SDR Highlights presets in the desktop app.** The SDR Highlights
  panel has a Preset button, but its group appears to be missing from
  the desktop app's list of allowed preset groups, so saving or listing
  those presets may fail. They should work like every other group's.

### Stage B — compare

- C, or the Compare toolbar item's switch, opens compare. `[` puts the
  selected photo on the left and `]` puts it on the right, from the grid
  and from the filmstrip, opening compare if it is not open.
- The left photo is the pinned reference and stays put. Arrow keys flip
  the right photo through the photos in the current folder or album, in
  the current sort and filter. Inside compare the selected photo is the
  right-hand one, so `[` moves it to the left and the next photo takes
  its place.
- Zoom and position are locked across both sides: click or Z for 100%,
  drag to pan, and both photos move together. They stay locked while
  flipping.
- Stars, pick, reject and colour labels act on the right-hand photo,
  with the same keys as elsewhere. Undo works as it does in the grid.
- Layouts, chosen in the option panel: side by side, top and bottom, and
  a split with a draggable divider. An option shows or hides file names
  and marks under the photos.
- The HDR switch applies to both sides.
- Two virtual copies of one photo can be compared like any two items.
- An edited photo is shown by its kept picture, as in single view. When
  one side is edited and the other is not, 100% means different things
  on each side; propose how compare should behave and what it says, and
  wait for Steve's answer before building that case.
- Flipping should feel instant. The right-hand neighbours are read
  ahead, as single view does today.
- Double-click on the large photos does not open Grade. Enter opens the
  right-hand photo in Grade through the usual gate.

### Stage C — exposure overlay

- E switches it on and off in grid, filmstrip, single view, compare and
  review.
- It marks blown highlights and blocked shadows, read from the photo's
  own data and not from a picture that has already been toned for the
  screen. For RAW that means the sensor data, so a highlight the picture
  shows as white but the file still holds is not marked blown.
- Options: strength, blown highlights on or off, blocked shadows on or
  off, and a colour for each.
- A small legend shows while an overlay is on. Clicking a colour square
  in it changes that colour.
- The PRD also proposes showing how much highlight range a photo holds.
  Do not build it now; say in your report what it would take.

### Stage D — focus overlay

- S switches it on and off in the same places.
- It marks the parts of the photo that are in sharp focus, so the sharp
  plane can be read on a thumbnail.
- Options: **strength**, sensitivity and colour. Strength works like
  focus peaking in a camera: low shows only the sharpest edges faintly,
  high marks them boldly. Moving it responds at once.
- Sharpness cannot be judged from a thumbnail, which has already lost
  the detail. It has to be measured from a decode with enough detail and
  kept as a small map that is drawn over any size of picture.
- High-ISO noise must not read as sharp detail. Make an allowance, and
  say how.
- **Measure before fixing the method.** A full quick decode costs
  roughly 1.5 to 6 seconds per photo on the sample files (PRD section 7,
  M1), which is too slow to cover a large folder. Compare maps made from
  the half-size decode the Library already does with maps from a full
  decode, on real photos that include soft, sharp and high-ISO frames.
  Report time per photo, size on disk and whether the half-size map
  tells sharp from slightly soft. Recommend one and wait for Steve's
  answer.

### Both overlays

- Maps are made in the background, only once that overlay has been
  switched on, photos on screen first. Work for photos that scroll away
  is dropped.
- Until a photo's map is ready it shows without the overlay and with a
  quiet sign that it is still being worked out, so "no marks" is never
  mistaken for "nothing blown" or "nothing sharp".
- Maps live in the cache area and count toward the one storage limit.
  They can be remade, so they go before pictures of edited photos when
  space is needed.
- A map belongs to one version of one file. If the file changes, the map
  is not shown.
- **Edited photos.** The overlays are culling tools and are measured
  from the original, but an edited photo is shown by a kept picture that
  may be cropped, rotated or lens-corrected, so a map would not line up.
  Propose the simplest honest behaviour (for example, no overlay on
  edited photos, with a tooltip saying why) and wait for Steve's answer.
- The remembered settings (colours, strength, sensitivity, which
  exposure warnings show, compare layout) are kept with the other
  Library preferences, not in the database.

## Constraints

- Do not change Grade's rendering, export, Proof, any existing shader,
  any pinned tolerance, limit or budget, or the Grade and export decode
  routes. The Library's own drawing may gain what it needs. Stage A's
  first fix touches what counts as a grade: it must not change what any
  saved grade renders, exports or proofs. If it would, stop and tell
  Steve first.
- Grade's own overlays (zebra, false colour) are a separate feature.
  Leave them as they are apart from the Stage A fix.
- Originals are never written. Nothing new is written beside photos.
  Looking, comparing and switching overlays write no settings file.
- Background map making must not slow grading, export or scrolling.
- Every new action is a backend command first (PRD rule F5).
- Keep slices 1 to 3 working and their checks intact.
- Pre-1.0 rule: no migration code. If the cache layout changes, say in
  one line what happens to an existing cache.
- Follow `docs/design/HDR_Finisher_Design_Guidelines.md` and the
  mock-up. Keep new controls simple; Claude refines the look afterwards.
- Keep each source file's existing line endings.
- Small local commits, each undoable alone. Do not push. Do not rebuild
  the installer.

## Testing

Follow `AGENTS.md`: fast checks on every change, GPU checks grouped per
stage, no broad sweeps. Stage A's first fix touches the grade document,
so also run the checks that cover saving, reopening, export and Proof of
a photo opened from a settings file. If validation for a stage is
heading past roughly 30 minutes of slow tests, stop and tell Steve
first.

Add fast data checks in the style of the existing library tests. At
least:

- an overlay switched on and saved leaves the photo Not edited, and a
  real edit still marks it Edited;
- a map made from a known synthetic picture marks the expected regions
  for blown, blocked and sharp, and stays clear on a flat or evenly
  noisy one;
- a map is not reused after its file changes;
- maps are evicted before pictures of edited photos.

One focused Electron check per stage for the visible part, on disposable
copies only: compare keys, both sides locked at 100%, marks landing on
the right-hand photo, each layout, and each overlay drawn in grid and
single view with a changed colour and strength.

Then ask Steve to try each stage on a real shoot; how it feels is his
call.

## Documentation

In the same change as the code, update `docs/technical/photo-library.md`
to describe compare, how each map is made and kept, the new messages and
log events. In the PRD, mark each stage built in section 8. Add compare
and the overlay maps to the code map.

## Report to Steve after each stage

Plain language, short: what now works and what to try; anything that
differs from this brief and why; any decision he needs to make, one at a
time, each with its trade-off and what could break; the new messages;
the measurements this brief asks for; what was run and anything that
failed.

## Questions protocol

You have the code; this brief describes outcomes, not how to reach
them. If an outcome here conflicts with how the code works, or two
outcomes conflict with each other, stop and ask before building. Do not
invent a new product behaviour to resolve it. If something would take
much longer than its value suggests, say so and propose the smaller
version.
