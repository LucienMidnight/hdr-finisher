# Codex Brief: Library responsiveness core (lock, maintenance, fullscreen window)

## HDR Finisher, Photo Library

**Date:** October 25, 2026 · **Written by:** Claude, for Steve · **Read first:** `ai/AGENTS.md`

## Goal

With Steve's 155,000-photo index loaded, and while indexing or maintenance runs
in the background, the following must feel immediate and must not get slower as
the library grows:

- opening a small folder;
- rating or marking a photo;
- moving forwards and backwards in fullscreen.

This brief covers the first four steps of the plan in the October 25 review,
recorded in [Photo Library, prepared-folder culling](../../product/modules/photo-library.md#prepared-folder-fullscreen-culling-october-25-2026):
instrument, take the foreground off the shared lock, make maintenance
incremental, and keep finished fullscreen pictures ready around the current
photo.

Persistent finished-preview files, codec choice, Prepare/Build previews and
native 100% previews are **not** part of this brief. They follow once this core
is fast.

## What the review found

Treat these as findings to confirm in the code, not as an implementation plan.

1. **One shared lock serialises foreground work behind library-wide work.**
   Measured October 25 from `%APPDATA%\hdr-finisher-desktop\logs\backend.log`
   and a copy of `library.sqlite3`.
   - Many paths take `LibraryMarks._lock`: `LibraryDocuments.request` (used by
     the fullscreen/grid `/live-plan` cache check), every marks change via
     `_result()`, `marks.read`, folder listing and the settings-writer
     acknowledgement.
   - Several of these run `membership.reconcile()`, which reads and re-snapshots
     the whole `files` table (155,877 rows, ~76 MB of facts). Its read side took
     ~1.3 s on the copy.
   - Indexing runs `remember_facts` and then `reconcile` after every 32-photo
     batch: about 1.5 s of backend work per ~0.35 s helper batch.
   - Results during indexing: the `live-plan` check went from a p50 of 18–50 ms
     to ~1.05 s (max 16 s); rating changes took 3.5–8.3 s (previously 15 ms);
     badminton listed 1.9–2.35 s after a 31–42 ms scan, and HDR Test Images
     took 6.1 s.
   - Every rating calls a full `reconcile`, so ratings probably stay slow (about
     1 s or more) even after indexing finishes. This is unconfirmed.
2. **Library-size costs on folder open.**
   - `remember_scan` selects with `substr(path,1,N)=prefix`, which is a full
     table scan (61 ms). A path range uses the index (under 1 ms).
   - A folder open reconciles twice.
   - The `D:\Photos` pin covers the whole library, and its 300-second check
     walks and deep-copies all entries.
   - The database uses the rollback journal (not WAL) and a new connection per
     call.
3. **Every fullscreen flip re-renders from scratch.**
   - Even with the 2560 scene cached, each flip runs the `live-plan` check, then
     waits for the one serial draw lane shared with filmstrip cells, then polls
     a GPU lease every 50 ms.
   - The backend `/live-pixels` then loads 25 MB of float16, makes a float32
     copy, sets up a render cache and repacks to 34 MiB of rgba16f (~155 ms
     warm), followed by transfer, upload and Grade's full finishing graph.
   - After the draw, `resetSession` discards the result.
   - Neighbour read-ahead only checks the cache; it never draws.
   - Draw logs since Oct 24 (grid and fullscreen mixed): fetch p50 144 ms, draw
     p50 172 / p99 2,373 ms, queue wait p50 2.2 s. Fullscreen draws cannot be
     separated in the logs today.
4. **Full cache.** `library-full-pictures` holds 366 entries in 9.98 of 10 GiB.
   This brief does not change allowances; it is recorded here so timing runs
   state their cache state.

## Outcome spec

Work in four steps, as small local commits. Report back after Step 0 and again
after Step 1, before starting the next step.

| Step | What must be true afterwards |
| --- | --- |
| 0. Instrument | The logs can answer, per fullscreen key press: time to the correct finished picture, split into cache check, queue wait, lease wait, pixel fetch, upload, render and present, tagged as fullscreen (not grid or filmstrip). Lock wait and hold times are logged for folder listing, reconcile, document lookup, marks changes and index batches. The Sony embedded-preview grid path is timed with the same stopwatch, as Steve's responsiveness baseline. |
| 1. Foreground off the shared lock | The fullscreen and grid cache check and the grade-identity lookup never wait behind library-wide work. A rating or mark change does work proportional to the photos it changes, not to the library. A folder open does work proportional to that folder (one scoped reconcile at most; indexed path lookups). Listings, ratings, sidecars, grades, album/tag membership and virtual copies produce the same results as before. |
| 2. Incremental maintenance | Index batches, folder checks and kept-album checks reconcile only what they touched. Any library-wide pass runs as low-priority short chunks that let foreground requests in between. Readers are not blocked by index writes. The whole-library pin check no longer re-walks and re-imports 155k entries each cycle when nothing changed. Behaviour after indexing completes is measured and reported. |
| 3. Fullscreen ready window | In Single/fullscreen, finished pictures for a small number of neighbours (about ±2, biased in the direction of travel) are drawn ahead with today's live renderer and kept, so arriving at them presents an existing picture. Fullscreen work is never stuck behind filmstrip or grid draws. Superseded neighbour work is cancelled on fast navigation. Changing grade, HDR/SDR, display or source invalidates the affected kept pictures; a kept picture is never shown for the wrong photo or an obsolete grade. Kept GPU memory stays within the existing broker budgets and yields to Grade, export and Proof. |

Codex chooses the mechanisms: lock structure, snapshots, connection handling,
queue design and how kept pictures are owned. If a finding above turns out
wrong in the code, say so and adjust.

## Proposed tolerances and acceptance checks

Record these in the module PRD when the work lands. They are proposals Steve has
not agreed; measure against them and report.

| Check | Proposed target | Why |
| --- | --- | --- |
| Rating/mark acknowledgement during indexing | p95 at most 100 ms | Culling rates on every photo; today it is 3.5–8.3 s. |
| `live-plan` cache check during indexing | p95 at most 30 ms | Matches the idle p50 band of 18–50 ms. |
| Badminton folder listed after scan, indexing running | at most 0.5 s | October 18 baseline was about 0.6 s total. |
| Folder open and rating time, 155k copy versus small copy | within 10% | The existing shared-machine timing tolerance; proves the cost no longer scales with library size. |
| Sequential flips inside the ready window (Step 3) | p95 key-to-picture at most 100 ms at a steady pace of about 2 photos/s; report the real sustainable pace | Proves the window. Do not tune it to a target; Steve judges it by using it. |
| Pixels | Library pictures unchanged | No rendering maths changes in this brief; reuse the existing perceptual guide if any doubt arises. |

Report every timing as p50/p95, stating idle versus indexing, cache state and
whether the folder was on the USB HDD or SSD.

## Safety and data rules

- Steve's live index (`%APPDATA%\hdr-finisher-desktop\library.sqlite3`), photos,
  sidecars, ratings and grades must not be used for experiments. Use copies and
  a scratch app-data directory for any test that writes.
- Copying the live database while the app runs is acceptable for read-only
  timing.
- No migration or compatibility code for older databases (pre-1.0 rule). If a
  schema or journal-mode change makes an existing database need rebuilding,
  say so in one line. The index is rebuildable, but Steve's ratings and grades
  are not; confirm where they live before anything could touch them.
- Do not change export, Proof, Grade output, shaders, tolerances or cache
  allowances.

## Testing: absolute minimum (Steve, October 25)

Steve asked for the least testing possible, to save time. This is below
`ai/AGENTS.md`'s usual level on purpose; he will judge speed by using the app.

- Run the fast checks (`node --test tests/*.test.js` and
  `.venv/Scripts/python.exe -m pytest tests -q` from `codebase`) once per step,
  not once per commit.
- Add only a few small result-checking tests where they protect Steve's data:
  - ratings, sidecars and folder listings unchanged;
  - no stale photo or grade from the ready window.
- No GPU drivers for Steps 0–2. For Step 3, at most one existing Library
  Single/live driver, once, at 2560x1440.
- No release runner, sweeps, endurance or repeated timing runs. Take timings
  from the new log lines during normal use, or from one short run on a database
  copy.
- If a new driver is added anyway, list it in `codebase/tests/release/drivers.json`.
- Export, Proof and shaders are out of scope. If a change touches them after
  all, stop and ask rather than testing broadly.

## Questions protocol

Ask before:

- inventing a new cache tier or file format;
- changing what a rating, grade or album write persists;
- changing priorities between Library work and Grade, export or Proof.

If the code contradicts a finding here, trust the code and report the
difference.
