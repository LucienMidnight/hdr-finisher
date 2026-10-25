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

## Step 1 outcome — October 25, 2026

Foreground document/grade lookup now reads committed grade and copy state on a
read-only SQLite connection, before reading the atomic sidecar. Pending desired
grades still win; default, recovery and copy selection retain their semantics.
It acquires neither application lock. Existing session-before-Library locking,
including the export snapshot regression, is unchanged. Database initialisation
uses SQLite WAL so an index write cannot block this reader; existing settings
tables and recovery formats are unchanged and no rebuild is needed. Smart-album
cache invalidation includes a process-local commit serial and WAL stamp, so
rapid writes still refresh candidates when the main-file timestamp is unchanged.

Marks reads/results and writer acknowledgements reconcile only the affected
original/copy families, retaining other recovery records. Folder listing skips
the scan's full reconcile and does one scoped reconcile in the marks read.
Folder facts and copy-family lookups use indexed path ranges; membership
annotations query only the requested families. Background full reconciliation,
kept checks and pin walks remain Step 2 work. Their shared-lock waits can still
hold up ratings and folder opens; Step 1 does not meet all responsiveness targets.

Step 0 normal-use logs since 513715b: 127 index batches held the lock for
1,375/1,610 ms (p50/p95); 343 document lookups waited 0/203 ms and held it
0/16 ms. Two folder listings waited at most 47 ms and held it at most 453 ms.
Browser grid cache checks were 284/4,280 ms. There were no marks-change or
fullscreen-tagged stage samples, so ratings and per-stage fullscreen timings
cannot yet be assessed from normal use.

One short disposable-data run used a read-only SQLite backup (155,879 files),
a small comparison copy, and one scratch PNG on D:. Other personal-state rows
were removed from the test copies only. Database pages were warm after setup;
no scene/render cache was involved. Drive medium was not verified; this was
not a USB badminton-folder run. The indexing condition used repeated one-photo
metadata batches with 20 ms pauses, without helper decoding. Each condition had
12 ratings/lookups and four post-scan listings. Reported times cover backend calls, not HTTP/page work.

- During indexing on the large copy, rating p50/p95 was 867/947 ms: misses the
  proposed 100 ms p95 target. Full background reconciliation still holds the
  shared lock. Idle was 179/391 ms.
- Document lookup during indexing was 4/15 ms, below the proposed 30 ms target
  for that component. The full live-plan HTTP request was not measured; do not
  treat this as a confirmed live-plan pass. Idle lookup was 6/7 ms.
- The one-photo scratch listing after scan was 735/737 ms during indexing,
  above 0.5 s; idle was 43/46 ms. Actual badminton was not measured.
- Idle small-versus-large rating p50/p95 differed by under 10%, as did listing
  p50/p95. During indexing the 10% scaling proposal failed because of shared
  waits (small-copy rating 259/456 ms, listing 121/140 ms).

Targets remain proposals. No live database, photos or sidecars were changed.
Validation: Node fast checks 603 passed. The single Python fast run had
2,541 passed, 3 skipped and two failures: an earlier version of the new copy
test bypassed the proper grade baseline, and the existing same-timestamp
smart-album check exposed WAL cache invalidation. The corrected real-save test
and WAL invalidation fix passed the 22 affected tests (smart albums, membership,
three new foreground results and the existing export/grade deadlock regression).
The recovery-manifest publication-order correction was also covered by these
focused checks. No full-suite rerun, GPU drivers, sweeps or further timing run.
Stop here; Steps 2–3 remain open.


## Step 2 outcome — October 25, 2026

Index metadata batches reconcile only their changed original/copy families.
Folder checks apply only added/changed/removed entries; kept-album checks read
facts for their current paths and reconcile only observed changes, including
missing members. Copy-family membership lookups use indexed ranges. A full
scan imports facts in 32-photo pages and checks removals in bounded key pages.
Explicit full membership maintenance uses key-only pages and reconciles small
batches, releasing the Library lock and yielding between them. Unchanged facts
in pinned families do not need recovery reconciliation. Removing a pin no
longer owns the Library lock for the full maintenance pass. Session-before-
Library ordering and the export/grade snapshot path are unchanged.

On Windows, periodic non-visible pin checks use recursive filesystem change
notifications covering names, directories, attributes, size and last-write.
After establishing a scan baseline, an unchanged D:\Photos pin is neither
walked, deep-copied nor re-imported every 300 seconds. Visible-folder and explicit
checks still scan. A dirty pin still needs a walk; unsupported/failed watchers,
interrupted checks and disconnect/reconnect fall back to a scan. This avoids
trusting directory timestamps, which miss edits inside existing files. Recovery
record contents and publication order are retained through chunked passes.

One short run repeated Step 1's workload: read-only SQLite backup, disposable
small/large copies with personal-state rows cleared only in those copies, one
scratch PNG on D:, 12 ratings/lookups and four post-scan listings per condition,
repeated one-photo metadata batches with 20 ms pauses for simulated indexing.
The new large copy held 155,883 files including the scratch PNG. Pages were warm
after setup, no scene/render cache was involved, and drive medium was unverified.
These are backend calls, not HTTP/page or actual USB badminton-folder timings.

All figures below are p50/p95 in milliseconds:

| Copy / condition | Rating | Document lookup | Post-scan listing |
| --- | --- | --- | --- |
| Small / idle | 115.40 / 343.14 | 1.11 / 1.24 | 5.28 / 5.86 |
| Large / idle | 108.49 / 334.85 | 1.20 / 1.46 | 5.91 / 5.96 |
| Small / indexing | 152.14 / 221.97 | 6.09 / 6.68 | 72.57 / 73.50 |
| Large / indexing | 143.43 / 222.38 | 6.45 / 7.76 | 66.03 / 72.54 |

Large-copy indexing rating p95 improved from Step 1's 947 ms to 222 ms, but
still misses the proposed 100 ms target. Listing improved from 735/737 ms to
66/73 ms, below 0.5 s for this scratch folder; actual badminton remains unmeasured.
Document lookup is below 30 ms; this does not establish the complete live-plan
HTTP timing. Large/small ratings (both conditions) and indexing listings stayed
within the proposed 10%. Idle listing p50 differed by 12% (0.63 ms), missing that
proposal; idle listing p95 differed by 2%. No repeat timing run was made.

The idle rating cost is durable I/O, not a remaining whole-library query. One
rating profiled inside the same run took 107 ms: 58 ms in SQLite transaction
commits and 32 ms in fsync for the pending recovery record; all scoped membership
queries together took about 6 ms. Large idle rating was 108/335 ms versus Step
1's 179/391 ms. The historical ~15 ms is not reproduced by this durable-write
path on this storage. Eliminating these flushes would change durability or need
a separate write/acknowledgement design; it is not a cheap Step 2 removal. The
synthetic indexing loop also commits repeated metadata writes and competes with
the sidecar writer. No durability setting or recovery guarantee was weakened.

Costs that still scale: initial/explicit/dirty-pin filesystem walks and cached
scan assembly; total key pages in a full membership pass; album-member checks
with the number of kept paths; recovery manifest work with the number of
protected families when membership changes. Explicit pin impact calculation
still reads library paths. Full walks and totals are not constant-time, but
background database maintenance no longer holds one lock across those totals.

The timing run preceded the final finer yielding for multi-photo recovery and
sidecar/removal reads; no timing rerun was made. Windows can conservatively
signal several notifications for one edit, so a dirty pin can receive an extra
scan; quiet checks with no pending signal skip the walk.

Validation: Node fast checks 603 passed. The single Python fast run had 2,546
passed, 3 skipped and one failure in the new test's assumption of exactly one
Windows event per edit. Corrected that assumption; 161 affected Library result
checks then passed. Four final checks passed for export/grade snapshot locking,
removed-folder pending marks, nested-edit notifications and index retry. No
full-suite rerun. Background recovery/sidecar reads now yield per photo family,
since one protected record may itself need a durable flush.
No GPU drivers, release runner, sweeps, or extra timing runs. Live database was
opened read-only only for backup; no live database, photos or sidecars changed.
Step 3 remains open; stop after this step.

## Step 3 outcome — October 25, 2026

Single/fullscreen now keeps the current finished live canvas and up to two
neighbours on each side. It draws the first two in the direction of travel
before the two behind. Arrival at a finished entry swaps that canvas into view;
there is no cache-check, pixel fetch, upload or finishing render on that hit.
This uses the existing renderer and in-memory finished surfaces, with no new
persistent preview files, codecs or shader changes. Single no longer starts
the separate twelve-photo source-only read-ahead alongside this small window.

Selected draws have priority over neighbour draws; both preempt lower-priority
filmstrip/grid draws through their cancellation gates. Already submitted GPU
commands must finish. Navigating cancels unfinished non-selected neighbour
work, including its source demand when its last user leaves. Photo path,
grade identity, source size/mtime, HDR/SDR and display epoch gate reuse. Grade
and file changes, mode/display changes, GPU loss and leaving Single discard
affected surfaces. The previous photo or grade stays hidden until the selected
finished surface is accepted. Small result tests exercise late cancelled
completion, identity changes, back/forward canvas swaps and grade replacement.

Kept surfaces report conservative triple-buffer HDR bytes to the existing GPU
broker as inactive resident memory. They share the existing 512 MiB finished-
surface pool ceiling with detached tiles, and admission leaves room for the
existing graph lease. No allowance or priority relative to Grade, export or
Proof changed. The existing broker permit is checked every 100 ms; competing
work or reduced room discards the window. Budget reporting is serialized and
uses the configured/calibrated budget before shared deductions, like Grade's
existing activity report. No backend broker or output code changed.

Rating and pick feedback now appears immediately. Commands capture photo paths
at the key press and save in order; navigation never awaits that command queue.
Pending per-photo overlays keep an older reply from replacing a newer visible
rating. Failed saves restore the last acknowledged marks and show the error.
The backend SQLite commits, recovery fsync, sidecar publication and durable
acknowledgement are unchanged. Review found no small safe transaction merger
without reworking recovery/sidecar ordering. An optional future choice is relaxed
SQLite sync or delayed recovery flush: fewer blocking flushes, but recent ratings
could be lost after power failure. Neither option was applied.

Read-only normal-use logs since 002519f (15:00:28 Bangkok), not a timing run:
17 completed fullscreen flips, one cancellation, 18 cache/queue samples.
Independent p50/p95 stage milliseconds: cache check 23.2/690.8; queue wait
0.3/0.5; lease wait 3.5/1227.6; pixel fetch 195.2/408.8; upload 15.6/18.7;
render 2110.6/2842.7; present 3.9/9.1; key-to-picture 2847.0/3645.4.
Fourteen marks-change lock scopes waited 0/78 ms and held the lock 32/203 ms.
Whole-save/HTTP rating timings were not logged. These mixed normal-use records
do not distinguish idle from indexing or verify drive medium/cache residency;
they are not controlled USB/SSD measurements. Stage percentiles are not additive.
The earlier 107 ms rating profile (58 ms commits, 32 ms recovery flush) remains
historical evidence; no new save-time or sustainable-flip-pace claim is made.

Validation: the Node fast checks ran once: 601 passed, six failed because eager
client-ID initialization required crypto in renderer test harnesses. Made that
initialization lazy; all 26 affected checks passed. After the final cancellation
and accounting corrections, 24 focused result checks passed, including an actual
Single presentation-function check. Python fast checks ran once: 2,547 passed,
three skipped. The one existing library-fullscreen-raw driver ran once through
Electron at 2560x1440 with a disposable profile and copied photos. It timed out
waiting for the first fullscreen picture; its scratch log showed a shared-budget
refusal. The new report could feed an already reduced budget back as the total;
that calculation is corrected and result-tested. There was no GPU rerun, so the
corrected fullscreen GPU path and retained pixels remain unconfirmed on hardware.
No sweeps, timing runs, release runner, push, installer or live-data writes.

Try steady forward/back arrows in Single/fullscreen, then rapid reversals; rate
or pick and immediately arrow onward; return to check the original photo's mark.
Change a grade or HDR/SDR mode and revisit neighbouring pictures; try an export
while culling to check yielding. Misses still need source/cache discovery, source
preparation when absent, lease admission, float-pixel transfer/upload and the live
finishing graph. In-flight submitted GPU work can finish before cancellation.
The proposed 100 ms target and sustainable pace remain unverified; Steve judges
by normal use. Implementation stops at Step 3. Keep this brief active until the
fullscreen hardware result and normal-use acceptance are resolved.
