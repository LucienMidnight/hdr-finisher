# Codex Brief: Library speed, phase 0 quick wins
## HDR Finisher

**Date:** October 18, 2026
**Branch:** `gpu-raw-library`, from its current tip (it holds the GPU RAW
thumbnail work this builds on; not yet merged into `film-look-rebuild`).

**Updated October 19 (Claude):** Steve's real cache made each listing take
about 3 s and held up every stored thumbnail, so `LibraryCache.trim_soon()`
now limits routine trims to one every 20 s. That is an interim fix: replace it
with the running total below and remove `trim_soon`'s time limit. GPU warm-up
now also covers the GPU RAW development module (`frontend/library-gpu-raw.js`):
its device and pipelines take 0.2 to 0.8 s on first use.
**Module PRDs:** `docs/product/modules/photo-library.md` (open work item 1,
phase 0) and `docs/product/modules/desktop-and-release.md` (window before
the backend). Update both as this lands.
**Evidence:** `docs/technical/archive/library-speed-exploration-findings-2026-10-18.md`,
section 6.

## Goal

Three fixes from the speed exploration that are independent of the larger
Library speed design. None changes any picture.

| Fix | Today (measured) | What Steve should notice |
| --- | --- | --- |
| Show the app window before the backend is ready | Backend ready 7.26 s after launch; the window appears only then | The window appears at once, with a calm "Starting…" state, and becomes usable when the backend is ready |
| Keep a running total of the Library cache size instead of listing the cache folder after each saved picture | 17 ms at 70 entries, 197 ms at 1,000, 2.2 s at 5,000, per publication | Saving pictures stays fast however big the cache grows |
| Warm the Library's GPU pipelines, the GPU RAW development pipelines and the hidden delivery renderer during idle time after launch | First Library GPU draw 5.0 s; later draws about 0.23 s | The first picture after launch appears as fast as the rest |

## Outcome spec

- **Window first.** The window opens straight away. Until the backend is
  ready, nothing that needs the backend can be used, and nothing looks
  broken: no error icons, empty panels that flash, or "failed" states. If
  the backend fails to start, the window shows that plainly with the
  existing error handling. Remembered window positions and the Library
  pop-out keep working.
- **Cache total.** The cache size shown in settings and used for trimming
  stays correct when files are added, replaced, trimmed, cleared, or
  deleted outside the app (recover the total at the next start or when it
  drifts). Trimming still keeps the cache within its allowances.
- **GPU warm-up.** Warm-up runs only when the app is idle after launch and
  gives way at once to Grade, the Library and export. It must not delay
  the first picture Steve asks for, or slow launch. If there is no usable
  GPU, it does nothing.

How you build each one is your choice.

## Tolerances (proposed by Claude)

| Check | Limit | Why |
| --- | --- | --- |
| Window visible after launch | Within 1.5 s on this machine | Electron itself needs about a second to open a window |
| Cache bookkeeping per saved picture | Under 50 ms at 5,000 entries | Removes the growth with cache size; well below anything Steve would notice |
| First Library GPU draw after an idle launch | Within 0.5 s, or within 2× the warm median | Warm draws are about 0.23 s |
| Pictures | Unchanged | No pixel work in this brief |

## Constraints

- Do not touch picture development, decoders, codecs, the thumbnail file
  format, scheduling of Library picture work, export or Proof. Those
  belong to later phases of the speed plan.
- Do not change the camera RAW start, Exposure calibration or Fuji DR
  handling.
- Never write into Steve's photo folders or the read-only test projects.
  Use a throwaway cache folder for cache tests.
- Testing per `ai/AGENTS.md`: fast checks, plus the one or two GPU checks
  that cover startup and the Library cache. No release check.
- One small commit per fix.

## Questions protocol

If the code disagrees with this brief, or a fix turns out to need changes
outside these three areas, stop and ask before going further.

## Report back

In plain language for Steve: what changed, the three measured results
against the limits, and which checks ran.

## Outcome — October 19, 2026

Completed on `gpu-raw-library`, as three local commits. No merge or push.
No shader maths, development, decoder, codec or picture-format changes.

- Window visible 424 ms from Electron launch, including its startup: passes 1.5 s.
  The app check captured and verified the local Starting… screen before the backend.
- Cache bookkeeping worst 2.76 ms at 5,000 entries: passes 50 ms. A shared SQLite
  allowance ledger records final publications/replacements/removals. Startup,
  settings usage and eviction reconcile outside changes. Routine trim checks
  totals every time, with no 20-second limit and no directory listing under budget.
- First Library draw after idle launch 38.3 ms; later median 7.1 ms: passes
  the 500 ms alternative. Measured through the normal SDR GPU picture renderer
  with the existing 640 px gradient fixture, including transport and draw.
  Warm-up includes Library display/conversion, GPU RAW and hidden delivery pipelines;
  it uses existing descriptors, compiles asynchronously and yields to user work.

Validation: Node fast suite and Python fast suite; sequential Electron
`startup-state.js` and `library-gpu-raw-grid.js` at 2560×1440. The RAW grid
includes four camera makes and an edited saved-grade photo, using disposable
copies. No release check or installer build.

Check results: 539 Node tests passed. The full Python suite had 2,306 passes,
three skips and one failure for the new script's missing asset-version token.
The token was added; all 21 checks in that affected module then passed. The
14 cache behavior tests also passed after the final startup-scan refinement.
Both focused Electron drivers passed, including the edited RAW saved picture.
