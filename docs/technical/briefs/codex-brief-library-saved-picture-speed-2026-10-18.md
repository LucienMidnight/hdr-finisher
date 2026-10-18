# Codex Brief: Saved-grade Library pictures in about 1 second
## HDR Finisher

**Date:** October 18, 2026
**Branch:** `film-look-rebuild`, from its current tip.
**Module PRD:** `docs/product/modules/photo-library.md` (open work item 2)
and `docs/product/modules/export-and-proof.md`. Update both as this lands.

## What Steve sees

He opened the badminton folder after pasting a grade. The status bar said
"48 pictures waiting", and each thumbnail took a long time to change to
the new grade. The GPU fans did not spin.

## What the log shows (`backend.log`, October 18, about 15:56)

Saved-grade pictures now go through GPU delivery (`renderer: gpu`, from
`9ed8307`), but each one still takes about 16 s, one after another:

| Stage (`library_kept.produce`) | Median |
| --- | --- |
| `kept_source_ready`, route `reopened-photo` (full RAW reopen and decode on the CPU, then reduced) | 9.5 s |
| `kept_rendered` (GPU delivery) | 4.6 s |
| `kept_encoded` (Ultra HDR JPEG) | 2.2 s |

At about 16 s per photo, 48 photos take about 13 minutes. The GPU is
busy for a small part of each photo, which is why the fans stay quiet.
The CPU render used to take 25 to 34 s, so the GPU did help, but the
agreed target is about 1 s for a changed photo on screen when the app is
otherwise idle.

## Goal

After a paste or a save, each changed photo on screen shows its new
grade within about 1 s when idle, top-left first. A 48-photo paste
finishes within a couple of minutes, without making Grade stutter.

## What Claude suspects (confirm before relying on it)

- The source stage decodes the full 42 MP RAW, then shrinks it to the
  2560 px picture size. A smaller decode that still fills the target
  (for example, half-size demosaic when it is large enough), or reusing
  an already decoded source, would cut most of the 9.5 s.
- The photos go strictly one at a time. Decoding the next photo while the
  GPU renders the current one, and encoding in parallel, would overlap the
  stages.
- 4.6 s is slow for a 2560 px GPU render. Check how much of it is upload,
  waiting for Grade, readback or CPU-side preparation (for example Denoise
  analysis).
- The encode might use the faster in-process gain-map JPEG writer that
  Library thumbnails already use. Do not change the export encoders.

Measure the stages first, then fix the largest. The design choices are
yours.

## Constraints

- The picture must stay within the agreed perceptual limits against the
  GPU export at the same size and settings (ΔE 2000 / ΔE ITP, mean below
  1.0, p99.9 at or below 3.0).
- Export output, export encoders and gain-map maths do not change.
- Grade keeps priority. Visible photos come first.
- Never write into Steve's photo folders or the read-only test projects.

## Testing: light (Steve tests first)

- Fast checks before each commit.
- Measure the stage timings on a few badminton photos (read-only) from
  `backend.log`, and report them in one table.
- No release check and no long sweeps. Ask before anything slow.

## Hand back

A short plain-language note: the new per-photo times, how long a 48-photo
paste takes, and how Steve should launch the build to try it.
