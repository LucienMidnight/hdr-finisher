# Codex Brief: Cold non-RAW sharp draw (draw first, store later)

## HDR Finisher, Photo Library

**Date:** October 26, 2026 · **Written by:** Claude, for Steve · **Read first:** `ai/AGENTS.md`

**Status:** not started. This is the next brief in the Library responsiveness
work; see the status block at the top of
`docs/product/modules/photo-library.md`.

## Goal

Fresh (never-prepared) JPEG, PNG and TIFF photos reach their sharp draw in
about the time it takes to decode and prepare them, not 5–15 seconds.
Cold-folder culling is a core workflow (photo-library decisions,
October 25).

## What profiling found (commit 37c85b2)

Development time for one cold photo was dominated by the **scene handoff
round trip**. The non-RAW GPU route waits for backend acceptance (readback,
upload, store) before the viewer can draw.

| Format | Development | Scene handoff |
| --- | --- | --- |
| JPEG | 6.0 s | 5.5 s |
| PNG | 5.0 s | 4.4 s |
| TIFF | 14.8 s | 13.3 s |

Decoding, colour work and GPU preparation together took under 1.5 s. Part 0d
(d48d466) already fixed the same problem for the RAW route: draw first, store
in the background.

The previous "after" phase was cut short because Codex's session hit its
token limit (Electron exited with it), not because the app crashed. The PNG
and JXL after runs, the second repetitions and most finished-pixel
comparisons were never done.

## Outcome

1. **Draw first, store later.** Apply the Part 0d principle to the non-RAW
   GPU route:
   - Draw the thumbnail and screen preview from the GPU-prepared scene
     immediately.
   - Where possible, keep the GPU result for direct drawing instead of
     readback → backend upload → fetch → re-upload.
   - Store to the cache in the background afterwards.

   The existing correctness rules still apply: identity checks, atomic
   publication, never the wrong photo or an obsolete grade, finished pixels
   unchanged.
2. **First-fetch stall.** Find the ~2 s stall on the first JPEG quick fetch
   (scheduling or backend contention) and remove it if it's avoidable.
3. **Re-measure.** Re-run `codebase/tools/profile_cold_picture.js` once, both
   repetitions, for JPEG, PNG, TIFF, HEIC and JXL.
   - Report first visible / sharp before and after, including the
     finished-pixel comparisons that weren't completed last time.
   - Record results as you go, so a cut-off still leaves usable numbers.

## Not in scope

Report what remains for each of these, but don't change them:

- HEIC and JXL CPU-route speed (HEIC: 2.4 s decode plus 2.0 s
  normalise/colour; JXL: about 1.8 s full import);
- AVIF gain-map GPU reconstruction (estimated 3–5 days);
- stored screen previews (JPEG XL q90 decided, not built).

## Testing and safety

- Use the glossary terms in logs and reports.
- Absolute minimum testing (Steve, October 25): fast checks once, the
  profiler run, and at most one Library GPU driver once.
- Never write to Steve's live library database, photos, sidecars or cache
  folders.
- Commit and stop for Steve to try.
