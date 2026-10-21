# Codex Brief — Overlay pile-up, and Steve's feedback, October 17

## HDR Finisher

**Date:** October 17, 2026
**Branch:** `film-look-rebuild` (do not switch branches)

Read `ai/AGENTS.md` first and follow its testing rules. Do not overlap GPU
checks with any other run. Commit each item separately so any one can be
undone alone. Ask before pushing.

My notes on causes are guesses unless I say they were seen. Confirm the cause
in the code or the running app before you change anything.

---

## 1. The engine piles up overlay work and freezes the Library (urgent)

**What happened (seen, October 17, installed 0.9.1):** Steve had an overlay
on in the editor while grading a photo that has film grain. Then the
Library stopped loading any pictures. The backend process
(`HDR Finisher Backend.exe`) had grown to 26 GB and was still growing. It was
using about 7 CPU cores, and `backend.log` had stopped writing.

A `py-spy dump` of the backend showed:

- 10 request threads in `overlay()` (`main.py`, the
  `/api/session/{id}/overlay/{kind}` route). Each was rendering a full CPU
  adjusted frame through `render_cache.adjusted_frame`, all of them inside
  CPU film grain (`_apply_density_grain`, then `film_grain.preview_grain_noise`).
- 4 more `overlay()` threads waiting in `_acquire_frame_flight`.
- 3 threads in `scopes_for_adjustments`, doing the same CPU render with grain.
- Library requests (`health`, `grade_command`) stuck behind all of this.

**Likely cause (part seen, part guessed):** `frontend/overlay-ui.js` aborts
the previous overlay fetch when it sends a new one. The backend endpoint is
synchronous, so it keeps rendering a request the browser has already given
up on. During a slider drag, the abandoned renders stack up. CPU film grain
is slow and uses a lot of memory, so a few of these at once is enough to
starve the whole process. The overlay route has no stale-request check. The
preview route has one. The scopes route only checks for staleness after the
render is done.

**What should be true afterwards:**

- Dragging any slider with False Color, Zebra or the scopes open never
  builds a backlog. Once a newer overlay or scope request arrives for the
  same session and view, the older one is dropped, or stops soon after.
- Backend memory stays roughly flat during a long drag with overlays on, on
  a photo with grain and halation turned on.
- The Library keeps loading pictures while the editor is busy.
- An overlay map shows what the overlay is meant to measure. If film grain
  makes no meaningful difference to False Color or Zebra, leave grain out
  of the overlay render. If it does make a difference, keep it and say why
  in the commit. Grain noise should not paint speckled zebra stripes.
- A tolerance to agree before measuring: during a 30-second slider drag with
  an overlay on, backend memory should stay within 2 GB of its starting
  level. Propose a different number if that doesn't fit what you find.

**Also check:** whether the Library's own exposure and focus maps
(`/api/library/overlay-map`) can pile up in the same way while you scroll
quickly through a folder.

**Recovery:** when this happens, the app should get back to normal by
itself without a restart. Fixing the pile-up may be enough for that. Say
whether it is.

## 2. False Color and Zebra overlays don't work (editor)

**What's broken:** In the editor's Overlays menu, choosing False Color or
Zebra shows nothing on the image.

**What should happen:** The chosen overlay appears over the image and
follows edits, using the opacity, anchor, ceiling and threshold settings.

**Hypothesis:** this may be item 1 showing up in another way. Each overlay
render was taking so long, and piling up so badly, that none ever arrived.
Check this again after item 1 is fixed. If the overlays still don't appear,
find the real cause. Check on the GPU path, not only the CPU fallback.

## 3. Drag and drop files into the Library window

**What Steve wants:** Dropping compatible files onto the Library window opens
them, exactly as File › Open would. Project files (`.hdrfinisher`) dropped
onto the window open the same way File › Open would open them. A normal
drag and drop: the drop does not have to land on a particular folder or
spot.

- Files the app can't open are refused clearly. Nothing should fail
  silently.
- This must not break the Library's existing drags: moving photos between
  folders, and adding photos to albums. Those drags start inside the app and
  have to keep working as they do now.
- The editor window already accepts drops. Match its behaviour where that
  makes sense.

## 4. Remove the Peak estimate checkbox

The scopes panel has a **Peak estimate** checkbox. According to
`docs/known-limitations.md`, turning it on adds a small extra measurement of
the editing peak, so the scope can catch small, very bright spots that the
preview samples miss. Turning it off reads the peak from the preview samples
only.

**Decision (Steve, with Claude's recommendation):** remove the checkbox and
keep the more accurate behaviour: the extra measurement is always on.
Performance is good enough now that the option only adds clutter. Proof and
export already measure the whole image exactly, and they don't change.

- If keeping the measurement always on would noticeably slow down scope
  updates while dragging, stop and report it instead of choosing
  differently on your own.
- Remove the saved preference and any code that only the checkbox used.
  Update or remove tests to match, following "Changing tests" in
  `AGENTS.md`.

## 5. Export page: remove the "3/3 encoders ready" message

Remove the message from the Export page (`export-ui.js`,
`capabilitySummary`). If an encoder really is missing, the user should still
find out at the point it matters, for example when picking a format that
can't be used. Say how that case is handled now.

## 6. Library Focus and Exposure: colour pickers belong in their menus

**What's broken:** With Focus or Exposure turned on in the Library, their
colour pickers sit in a legend low on the screen, over the film strip
(`#library-overlay-legend` in `library-overlays.js`).

**What should happen:** Each colour picker lives only in the menu that drops
down when you click **Focus** or **Exposure** in the toolbar. Nothing sits
over the film strip. If a small key is still needed to show what each
colour means, it should not get in the way of the film strip. Suggest a
place for it and check with Steve before building it.

## 7. Library Focus and Exposure: use the app's toggle switches

The Focus and Exposure menus use plain checkboxes: the on/off control for
each tool, and the two Exposure options. Replace them with the toggle switch
already designed for the editor's control panel. Label them the way the
other toggles are labelled: **Enabled** or **Disabled**, depending on the
switch's position.

## 8. Film Look toggles always say "Enabled"

**What's broken:** The Halation and Grain toggles (Film Look panel) always
read "Enabled" whatever their position, and show an extra purple dot to the
left of the word.

**What should happen:** The label reads **Enabled** or **Disabled** to match
the switch, the purple dot is gone, and these toggles look and behave like
the ones in item 7. If the dot means something, for example "modified",
tell me what it means before removing it.

## 9. Library Exposure: clearer wording than "Blown highlights" and "Blocked shadows"

Steve finds these labels too vague. Find out exactly what the Library
exposure map marks: sensor-clipped values read from the raw data, values
clipped in the rendered picture, an estimate, or something else, and
whether that differs between raw files and other files such as JPEG, AVIF
and EXR.

Then propose new labels, and a one-line tooltip for each, that say plainly
what is shown, for example "Clipped highlights (sensor)". They don't need to
be technical, but they must be accurate. **Send Steve the wording before
changing it.** Use the same terms everywhere the overlay appears, including
the Library and its key or tooltips.

## 10. Move "Faster dragging" into a new Performance settings page

The editor's **Preview** toolbar menu holds only the **Faster dragging**
checkbox and a "Current preview size" readout. People rarely change it.

- Add a **Performance** page to app Settings, and move Faster dragging there.
- Remove the Preview button from the editor toolbar.
- If the "Current preview size" readout is still useful, find it a sensible
  place. Otherwise propose removing it.
- The General page already has performance-related settings (preview
  resolution, GPU memory). Moving them to the new page would make sense.
  List what you'd move and ask Steve first. Diagnostics stays where it is.

## 11. Remember the chosen theme between launches

**What's broken:** The theme picked under Settings › Appearance resets after
the app is closed and reopened.

**What I saw (unconfirmed):** `application-preferences.json` in
`%APPDATA%\hdr-finisher-desktop` has no theme field. `photo-library.js`
reads the theme from browser `localStorage`
(`hdr-finisher:application-preferences:v1`). The saved preferences and the
browser copy may be out of step, or one may overwrite the other on start.

**What should happen:** The chosen theme is restored in both the editor and
Library windows after a restart, and it applies straight away with no flash
of the default theme.

---

## Testing

Follow `AGENTS.md`: fast checks after every change, plus the one or two GPU
checks that cover what you touched. Group related items when running GPU
checks.

- Item 1 needs a check that would fail without the fix: many overlay
  requests sent quickly, then confirm the backend isn't left doing work for
  abandoned requests and memory stays within the agreed tolerance. Add any
  new driver to `codebase/tests/release/drivers.json`.
- Items 4 and 10 remove controls. Update the tests that used them, and list
  the removed tests in the commit.
- Items 6 to 9 change what the app shows. Check them in the running app at
  Fit and at 100%.

None of these items touch CPU export or Proof. If one turns out to, stop and
tell Steve before going further.

## Report back

For each item, one short line: what changed, what you ran, and anything left
over. Steve still needs to decide two things: the exposure wording (item 9)
and which General settings move to Performance (item 10).
