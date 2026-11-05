# Codex Brief: Library full-size zoom draws from the GPU first
## HDR Finisher

**Date:** November 5, 2026. Written by Claude for Steve.

## Goal

A Library zoom to 100% shows the sharp full-size picture within about
2.5 s on a 42 MP RAW and about 3.5 s on a 48 MP TIFF, measured from click to
detail drawn. It does this by drawing straight from the picture the GPU has
just developed. The backend copy and any disk storage happen afterwards, off
the path the user waits on. After a GPU-drawn zoom, panning and zooming in or
out again on the same photo need no disk read. The CPU route keeps working as
the fallback when there is no usable GPU.

## Steve's direction (November 5, 2026)

- Every photographer using the app will have a graphics card. He wants this to
  happen on the GPU, as high-performance creative apps do. The CPU route must
  still work as a backup.
- Avoid disk writes and reads on the zoom path. Many photographers keep large
  libraries on hard drives, not SSDs.
- Develop speed matters too, but it is not part of this brief: the focus is
  Library performance.
- Steve understands that Grade also holds its photo on the graphics card.
  Confirm how Grade actually holds and loads its source, and report it in
  plain language. Change Grade only where this work shares code with it (see
  Constraints).

This direction meets the master PRD's GPU rule: the expected gain is more
than 50% of the whole wait (42 MP 6.54 s to about 2.5 s).

## Context: what happens now (measured November 5, commit `08ef96e`)

The October 19 decision stands: keep one full-size scene for the selected
photo, so later zooms and pans reuse it, and draw only the visible part
(`docs/product/modules/photo-library.md`, decisions table). What is wrong is
the route the picture takes. It is developed on the GPU, then makes a round
trip through the backend and the disk before it is drawn:

1. The GPU develops the full-size picture (42 MP RAW: 0.9 s, including the
   source read).
2. The planes stream to the backend in 64 MB bands, as 32 MB requests
   (about 2.6 s for 42 MP, 5.0 s for 48 MP). This is built: commits
   `ff9aeac` and `08ef96e`.
3. For the live route, the backend saves a full-size scene file to disk
   before it answers (about 1.3 s for 42 MP, 1.7 s for 48 MP).
4. The draw (`library-gpu.js`, native branch) goes through Grade's
   source transport. The backend reloads that file into a native frame
   (0.6 s for 42 MP, 1.1 s for 48 MP; it is now held for 5 s, so this
   happens once). It then serves a 2560 Fit proxy and full-resolution
   source tiles back to the GPU (about 0.9 s).

Result: 42 MP RAW 6.54 s, 48 MP TIFF 11.81 s (idle, 4 GB setting,
2560 x 1440, `performance-table.md`). Before these two commits it was
9.24 s and 16.33 s. The memory record for the same day is in
`docs/product/modules/memory-and-caches.md` ("full-size zoom hand-off holds
one copy"). Reduced (2560 and thumbnail) live scenes already have a GPU-first
route: "direct scenes" in `library-gpu-raw.js` and `library-gpu.js`. They
draw from retained GPU textures and store to the backend afterwards. Full
size is excluded from that route today. Work out why before extending it.

## Outcome spec

| Situation | What the user experiences |
|---|---|
| Zoom on a photo with a usable GPU | Fit stays on screen; the sharp 100% picture appears after development plus a GPU draw, with no wait for an upload, a disk write or a disk read |
| Pan, or zoom out and back in, on the same photo | Uses the full-size scene already held; no new development; no disk read while it is held |
| Leave the photo, or memory is needed elsewhere | The GPU copy is released under the existing budgets. A later zoom may use the backend copy or develop again, but must stay correct |
| The backend copy | Still made for Compare's detail view, re-zooms after the GPU copy is released, and anything else that relies on it today, but in the background after the draw. Whether it must also go to disk is your call: keep disk storage only where something needs it, and say what |
| No usable GPU, or GPU lost | The existing CPU detail route works as before (visible-only CPU fallback decision, October 19) |
| Not enough memory | Refuses with the existing message and retry, as now. Never overshoots the whole-app limit |
| Saved grades, locals, rotation, crop, Denoise, HDR and SDR lanes, authored SDR references | Look the same as the current detail route, within tolerance |

## Tolerances (proposed here; record them in the module PRD)

- **Speed:** idle, 4 GB setting, 2560 x 1440, the existing copied
  `DSC00264.ARW` (42 MP) and `DSC04375_DxO_clipped_target.tif` (48 MP).
  Click to detail drawn: at most 2.5 s and 3.5 s, with 10% allowed for
  run-to-run noise. Fit and grid speed must not get worse beyond their
  existing tolerances.
- **Memory:** whole-app peak at most 4.4 GB on every zoom check, including
  the busy `--batch5c` check. The GPU copy and the backend copy must each be
  counted in the existing admissions. Raising an allowance, budget or
  estimate is Steve's decision. If one seems needed, stop and ask.
- **Pixels:** Library pictures are judged by eye ("close enough to enjoy",
  October 18). Compare GPU-first detail crops with the current detail route
  using the perceptual rule in AGENTS.md "Work within tolerances": mean below
  the just-noticeable level plus a high-percentile limit. The 1000-nit
  highlight ceiling stays exact. Any difference you cannot explain is a
  report, not a pass.

## Constraints

- Export, Proof and their outputs do not change. Shaders, tolerances, limits
  and budgets pinned for export and Proof do not change.
- Keep the October 19 single-full-scene design: no full-size development of
  neighbouring photos, and no new disk allowance.
- Grade's source transport is shared with the Grade editor. Grade's
  behaviour, pixels and speed must not change. Run the GPU checks that cover
  Grade's source loading and viewport rendering, not only Library checks.
- Keep the CPU fallback route working, and test it.
- Develop speed is out of scope. If you find a large, cheap develop win, put
  it in your report instead of doing it.
- Follow AGENTS.md for testing scale, the 100 GB output limit, cleanup, small
  local commits, keeping each file's line endings, and no push or installer.
- If validation would take more than about 30 minutes of slow tests, stop and
  report.

## Questions protocol

If this brief conflicts with the code, or with a recorded decision, stop and
report before building. That includes the reason full size is excluded from
direct scenes. Do not invent a new cache, allowance or route that the memory
PRD does not cover without asking.

## Report (plain language for Steve)

- Click-to-detail times for both photos, before and after.
- Peak memory for each check.
- How Grade holds and loads its photo today.
- What changed, the commits, and anything left open.
- Any decision Steve needs to make, one at a time, each with its trade-off.
- The output folder size at the end.

## Implementation outcome, November 5

Completed the first round under Steve's November 5 approval: one selected GPU
scene outside the sharp cache, counted in the existing shared GPU/whole-app
accounting, with prompt hand-over. Local adjustments, rotation and Denoise
keep the backend route. No allowance or development estimate increased.
Current results, tolerances and validation limits are recorded in the Library
and memory module PRDs and performance-table.md. Large-photo pixel A/B through
DevTools remains unqualified; synthetic finished-pixel comparisons and the
plain-Electron real-photo speed/memory checks passed.
