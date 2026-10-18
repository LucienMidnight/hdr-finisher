# Codex Brief — Copy and paste grades, and batch export

## HDR Finisher

**Date:** October 17, 2026
**Branch:** `film-look-rebuild` (do not switch branches)

Read `ai/AGENTS.md` first and follow it. **Start after the thumbnail-cache
work is committed**, and never overlap GPU checks with another run. The two
parts below are independent. Steve wants both done next, at the same time,
so you may run them side by side (for example as two agents). If you do,
agree who owns shared files first: the Library right-click menu and
shortcuts in `photo-library.js`, and the Activity bar. Commit each part in
small steps of its own. Ask before pushing.

The product decisions behind this brief are in the main PRD, section 11g
(items 3 and 5), with full detail in the Library PRD, sections 5.15 and
5.16, and section 4 (October 11). Where this brief and those documents
disagree, this brief wins; tell Steve in your report.

---

## Part A — Copy and paste grades (Library slice 7)

### Goal

Steve can copy one photo's grade and paste all or part of it onto one or
many photos from the Library. It must be easy to find. On October 17 Steve
went looking for it and found no UI at all.

### What the user can do

| Action | Behaviour |
|---|---|
| Copy grade | Ctrl+C in the Library (grid, filmstrip, Single, full screen) copies the selected photo's saved grade. Also on the photo's right-click menu as **Copy grade**, and in the app's Edit menu. The status line confirms "Grade copied from <file name>". |
| Paste grade | Ctrl+V, or **Paste grade** on the right-click menu or Edit menu, pastes onto the selection with the same ticks as last time. **It always confirms, even for one photo** (Steve, October 9). |
| Paste, choosing settings | Ctrl+Shift+V, or **Paste grade (choose settings)…**, opens the tick list directly. |
| Undo | One Ctrl+Z takes the whole paste back, on every photo it touched. Each photo also keeps its previous grade as its "before" state (the existing Restore previous grade). |

The commands are greyed out when nothing is copied or nothing is selected.
Text fields keep normal Ctrl+C/V.

### Confirmation and tick list

The look and layout follow the paste dialog in
`docs/product/library-wireframes/index.html` (open it in a browser). Build
it with the app's existing dialog, button, toggle and token styles. Don't
add new ones.

- Title: **Paste Grade From <file name>**. Body: **Paste Tone, Color, Look,
  Detail, and RAW development settings.**, naming what is ticked, plus
  **onto N photos** when there is more than one. A **Choose what to paste**
  button opens the tick list.
- The dialog says how many photos will change, that each keeps its previous
  grade, and what will be skipped for which photos.
- The tick list groups the existing preset groups (there are 24 group ids;
  `sdr-base` has no controls, and white balance and tint live in Colour):
  - **Tone:** tone, highlights, equalizer, zones, curves
  - **Colour:** colour, colour grading, black and white
  - **Look:** film look, vignette
  - **Detail:** detail, denoise
  - **HDR side / SDR side** as two master ticks at the top
  - **Outside the grade groups:** RAW development, lens corrections, crop
    and geometry, local adjustments and masks
- Each group twirls down to its settings. Each row shows **Mod** when the
  copied photo changed it from its own starting grade. Quick choices: All,
  Modified only, None.
- Unticked by default: masks and local adjustments, crop and geometry, lens
  corrections.
- A plain paste repeats the last set of ticks. Remember them between
  launches.
- **Not in this brief:** Looks (saved, named pastes), the "Save as look
  preset" button and linked photos. Build the tick list as a piece the Looks
  window can reuse later, but don't build Looks.

### Paste rules (decided by Steve, October 11)

- Never pasted, because they are measured from one photo: the measured
  highlight peak, the matched lens profile, the file interpretation,
  reference white, and overlay view settings. Lens on/off switches do paste.
- **RAW exposure** pastes as a change from the copied photo's own starting
  exposure, applied to each target's own starting exposure. This rule is
  temporary. The planned starting-exposure work (PRD 11g item 2) will make
  Exposure start at zero, and then exposure pastes as a plain number. Keep
  the rule in one clearly named place so it can be removed.
- Everything else pastes as numbers, including an SDR grade made by Match
  entire HDR grade.
- Settings that don't apply to a target's file type are skipped and
  reported.
- Virtual copies are separate items with their own grades. Pasting onto a
  copy changes only that copy.
- Paste saves at once, whatever the autosave setting.
- **The photo open in Grade:** if it is a target and has unsaved changes, go
  through the existing leave gate (Save, Discard, Cancel) before pasting
  onto it. Afterwards Grade shows the pasted grade, and Undo in Grade covers
  it.
- A photo whose settings file can't be written (offline, read-only) follows
  the existing rule for marks: the paste is kept and written later, and
  reported.

### Pictures after a paste (Steve: important, probably complex)

After a paste, no target has a Library picture matching its new grade. A
stale picture must never be shown. Library PRD section 8, "Carried forward
to slice 7", has the full requirement. In short:

- Queue the new pictures through the existing backend producer of
  saved-grade pictures. Virtual copies are separate items; don't collapse
  work by source path.
- Until a photo's picture is made, show its default look with a clear
  "updating" mark. No rough picture first. Photos on screen are done first.
- A job in Activity with a count, Pause and Resume. It gives way to Grade,
  export and pictures for the screen.
- The list of photos still to do survives a restart, a crash and an
  unplugged drive.
- Undo and Restore previous grade are instant: keep the previous picture
  with the before state.
- A second paste onto the same photos before the first is done makes one
  picture, for the latest grade.
- These pictures count toward the saved-grade allowance of the new cache
  (thumbnail-cache brief).
- About 10 seconds per 36 MP photo today. Say in your report how long 100
  photos take, and how much of the processor the job uses.

---

## Part B — Batch export (Library slice 8)

### Goal

Steve can export many photos at once, each with its own saved grade, into
one or more versions per photo, with file names made from a pattern. It runs
in the background without blocking grading.

### Decided by Steve, October 11

- **The Export page stays and grows.** It holds every export setting. It
  gains a grid of the photos chosen for export and its own control panel. A
  selection sent from the Library arrives there as a batch.
- **Quick export…** on the right-click menu of a photo or selection asks for
  a folder and an **export preset**, then runs. Nothing else is asked.
- **Export presets** are made and edited on the Export page only. A preset
  carries every setting the Export page has today (format, quality preset,
  advanced settings for the format, dithering, metadata policy, resize, long
  edge or fit within width and height typed as any whole number, prevent
  enlargement, output sharpening, reference white), plus a name, a **file
  name pattern** and an optional **sub-folder**. One preset can hold
  **several versions**, for example an HDR AVIF and an SDR JPEG, each with
  its own settings, pattern and sub-folder.
- **Pattern naming applies to exported files only**, never to originals.
- The page must leave room for print settings and watermarks later. Don't
  build them.

### What to build, in this order

1. **Export presets.** Save, rename, duplicate, delete, with several
   versions per preset. Today's format-quality presets (Web Optimized,
   Maximum Fidelity) stay as they are inside each version. Store user
   presets with the app's other user presets, and say where.
2. **The export queue (backend).** It exports a list of items (photos and
   virtual copies), each with its saved grade, for every version of the
   chosen preset.
   - It runs in the background, one photo at a time, and gives way so Grade
     stays responsive.
   - Progress shows in Activity: count, time estimate, Pause, Cancel. A
     per-file results list says what was made, skipped and why, and what
     failed. A Show in Explorer link opens the output folder.
   - It has a memory plan for large files; state it.
   - **Never overwrite an existing file silently.** By default add " (2)",
     " (3)" and so on, and list those files in the results.
   - The photo open in Grade with unsaved changes exports its **last saved**
     grade, and the dialog says so before starting.
   - An HDR version on a photo with no HDR grade (SDR-only) is skipped with
     a clear line in the results.
3. **Quick export…** on the Library right-click menu and in the Edit menu
   (Ctrl+Shift+E): pick a preset and a folder (remember the last ones), then
   run.
4. **Naming patterns.** Tokens at least for: original file name, virtual
   copy name, sequence number (with padding), capture date in a few formats,
   rating, version name and preset name, plus free text. Show a live example
   name in the preset editor. Characters that aren't allowed in file names
   are replaced, and the editor shows how.
5. **Export record.** Record what was exported, when, with which preset and
   version, and where. It feeds two new states: **Exported** and **Edited
   since last export**, usable in the filter bar's State field and in smart
   albums. A plain-language line in Details shows the last export.
6. **The Export page batch grid.** Follow Claude's mock-up,
   `docs/product/export-wireframes/index.html` (serve the `ai` folder and
   open it; the yellow strip at the top switches states and is not app UI;
   its Notes button summarises the design). It shows:
   - Export presets on the left, made and edited only here, each with one or
     more versions. The right-click menu offers Rename, Duplicate, Delete.
   - The batch in the centre: a grid of the photos to export, with Grid and
     Preview views. From Grade it arrives with one photo and opens on
     Preview with scopes, as today. From the Library it arrives with the
     selection and opens on Grid. Add Library selection, Remove (takes
     photos out of the batch, deletes nothing), Clear.
   - Per-photo flags in the grid: unsaved changes in Grade (last saved grade
     used), SDR only (HDR version skipped), and a count of files per photo.
   - The control panel edits the selected preset: name, Save, Save as new,
     Revert, a Modified mark, version tabs with + Add version, the existing
     settings per version, then File Name (pattern, token buttons, live
     example) and Sub-folder. The Destination folder belongs to the run, not
     the preset. A summary line, then **Export N files**.
   - Running: a progress strip under the grid (count, time left, Pause,
     Cancel), per-photo Done badges, and Activity showing the job.
   - Finished: a results list (file, photo and version, outcome: exported,
     renamed with a number, skipped with the reason) and Show in Explorer.
   - Quick export… dialog: preset, its versions with example names, folder,
     notes about unsaved and skipped photos, and a link to open the Export
     page with the same photos instead.
   It reuses the app's own stylesheet. Use the app's existing components
   and tokens, not the mock-up's CSS. Where the mock-up and today's Export
   controls differ in detail, keep today's controls and their wording.

### Not in this brief

ExifTool, metadata authoring (title, caption, creator and copyright
template), privacy options beyond today's metadata policy, and naming an
unknown lens. These come in a follow-up.

### Strict area

**The exact CPU export is called, never changed.** A batch export must
produce the same files as exporting the same photo, grade and settings one
at a time from the Export page today. Check this by comparing the files'
decoded pixels and their gain-map metadata. That is an exact-match
guarantee, with no tolerance. If any change touches export or Proof code,
run their strict checks and tell Steve before going further.

---

## Testing

Follow `AGENTS.md`. Fast checks after each change. GPU checks only where
they cover what you touched. Add each new driver to
`tests/release/drivers.json`.

Checks to add (they check results, not wording):

- **Paste:** pasting onto 3 photos, including a virtual copy, changes
  exactly the ticked groups, leaves the never-pasted values alone, applies
  the exposure rule, and is fully undone by one Ctrl+Z. The Library never
  shows a stale picture after a paste or an undo. The pending picture list
  survives a backend restart.
- **Batch export:** a 3-photo, 2-version preset makes 6 files with the
  expected names, sub-folders and no overwrites. Each file matches a
  single export of the same photo and settings exactly. Cancel leaves
  finished files and no partial ones. The Exported and Edited since last
  export states are correct.

Use disposable copies of photos. Never write into `D:\Photos` or the
read-only test projects.

If validation is about to take more than about 30 minutes of slow tests,
stop and ask Steve, per `AGENTS.md`.

## Report back

For each part: one short line per step built, what you ran, and anything
Steve needs to decide or try. Include the time for 100 pasted photos'
pictures, and the export throughput for 10 RAW photos with a 2-version
preset.
