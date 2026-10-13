# Photo Library speed: findings and proposed architecture

October 12, 2026. Draft by Claude for Steve's review. Nothing here is built.
It follows the ranked waits in `photo-library.md` section 15 (ranks 1–6).

Status of each claim is marked: **measured** (timed by Claude on a disposable
42 MP ARW copy, warm disk, `.venv` Python), **trace** (read from Codex's
recorded runs in `codebase/output/library-slow-spots`), **code** (read from
the source, not run), or **guess**.

## 1. What is actually slow

The decoding itself is not the problem. The waits come from five structural
causes.

| Cause | Evidence |
|---|---|
| A. Nothing is shown until the final picture is ready. No quick first picture, no reuse of a smaller picture already on hand. | code: `loadAndShow` asks for `quick` for every camera RAW; the embedded-preview route exists but is used only for DNG/HEIC/TIF. measured: embedded preview 17–170 ms; quick decode 0.3–0.6 s. |
| B. The first Library draw pays a one-time cost of 3–6 s. | trace: first `/pixels` fetch to next fetch is 2.9 s (`development-final`) and about 6 s (`development`); later draws about 28 ms each. code: the Library draws through the whole Grade renderer (`HDRLibraryGPU extends HDRWebGPUPreview`), which builds its per-format pipelines on first use. Cause is a **guess** until timed. |
| C. Work is repeated or done the long way round. | measured: the saved-grade picture re-opens the RAW from disk in the helper (8.3 s) although Grade has the same corrected image in memory; shrinking that image takes 0.45 s. measured: every exposure map re-opens the RAW (1.8 s) although the picture decode just had it open. code: each picture size (192, 512, 2560) is a separate decode. |
| D. The helper is permanently throttled, even when the Library is the only thing in use. | measured: corrected open 8.3 s under helper conditions (one thread, below-normal priority) against 4.5 s without. code: `_worker_main_impl` sets this once at start. |
| E. The queueing rules can block each other. | code: kept pictures and exposure maps share one thread; that lane waits for folder checks, and a folder check waits for that lane's queue to empty. With one job running and one queued, neither moves. This matches the recorded stall (four maps ready, two pending) but was **not reproduced**. code: a paused helper throws away a decode in progress and redoes it. code: the page can use only 4 of the helper's 6 picture threads. |

Smaller items:

- measured: storing a 2560 px picture spends 1.2 s compressing it; writing it
  plain takes about 0.01 s and uses about 50% more disk. Compression is cheap
  (0.06 s) at grid size.
- code: `trim()` lists and stats the whole cache folder after every picture.
- measured: the kept-picture encode is 1.4 s; code: it launches an external
  tool three times.
- measured: backend load 2.4 s then helper start 0.9 s, one after the other,
  before any window is created (warm disk; a cold first launch is slower).
- trace: the first four decodes of a fresh helper each report about 5 s with
  a 12 ms spread, so they share one blocker. First-use imports inside the
  first build are the likely cause (**guess**).

Not yet explained: about half of the 20-second launch. Backend plus helper is
3–4 s and the first picture about 6 s. The rest needs stage timestamps from
one real launch (step 0 below).

## 2. Design principles

1. **Something on screen at once, then sharpen.** Every view shows the best
   picture already available and replaces it when a better one arrives.
2. **Open each photo once.** One open of a file produces every small product
   that will be wanted: grid picture, filmstrip picture and exposure map.
3. **Never redo what is already in memory.** A save in Grade makes the
   Library picture from the image Grade has open.
4. **Speed follows what Steve is looking at.** The helper runs at full speed
   while the Library is in front and steps back only while Grade is working.
5. **One queue, one direction.** Work is ranked by how visible it is. Lower
   ranks wait for higher ranks, never the reverse, so two jobs cannot wait on
   each other.
6. **Pay one-time costs before they are noticed.** Renderer setup and helper
   imports happen during launch, not on the first picture.
7. **A built-in stopwatch.** Each stage logs its time, so the next slow spot
   is found by reading a log, not by a new measuring project.

## 3. The architecture

### 3.1 Picture tiers

| Tier | Source | Time | Used for |
|---|---|---|---|
| 0 Preview | Embedded camera picture, or any smaller cached picture of the same photo | under 0.2 s | First paint in grid, filmstrip and Single |
| 1 Browse | Quick half-size decode with the default look (today's `quick`) | 0.3–0.6 s | Replaces tier 0 in place |
| 2 Full | Native decode (today's `native`) | as today | 100% zoom |
| Kept | Saved grade, exact route | see 3.3 | Edited photos |

Tier 0 is the camera's own rendering, so its colour and brightness differ
slightly from tier 1 and it is not HDR. The picture will visibly settle when
tier 1 replaces it. This is Steve's decision (see section 6).

Single view shows the cached grid picture immediately, enlarged, then the
display-size picture. It keeps the next two pictures in the direction of
travel, and the previous one, ready on the GPU, so a flip between neighbours
is immediate.

### 3.2 One open, several products

A tier 1 job for a photo writes the 512 and 192 pictures and the exposure map
from the same open file. Turning the exposure overlay on for pictures already
shown then needs no decoding. The display-size Single picture stays a
separate job, started by entering Single or by look-ahead.

### 3.3 Saved-grade (kept) pictures

- On save, the main backend shrinks the image Grade already has open to the
  kept size (0.45 s, off the save request) and hands that small image to the
  existing kept renderer. Same corrected source, same renderer, same output,
  so there is no quality trade-off. Estimated 10.9 s to about 2 s.
- Cases with no open photo (revert, virtual copies, the request route) keep
  today's re-open, but at full helper speed when Grade is idle (about 4.5 s).
- The encode step is left alone in the first round. It belongs to the export
  code, which is a strict area.
- Until the kept picture is ready, the Library keeps showing the previous
  picture with its existing "not current" mark.

### 3.4 Cache

- Grid-size pictures stay compressed. Display-size pictures are written
  plain, in the layout the GPU takes, and sent to the page without unpacking
  and repacking.
- Two separate storage pools, so large Single pictures can never push out
  grid pictures.
- The cache keeps a running size total and lists the folder only at start.

### 3.5 Scheduler

One ranked queue in the helper replaces the lane-specific waiting rules:

1. Pictures on screen (Single first, then grid, then filmstrip)
2. Look-ahead neighbours
3. Exposure and focus maps for pictures on screen
4. Kept pictures
5. Folder checks
6. Background indexing

Rules: a lower rank starts only when no higher rank is waiting; a running job
is never made to wait for a lower rank; maps no longer share a thread with
kept pictures; a job that has finished decoding always saves its result, even
if the page has moved on or Grade paused the helper; a paused job resumes, it
is not restarted. The page's request limit is raised to match the helper.

Helper speed: normal priority and several threads while the Library is in
front; today's throttling while Grade is in front or working.

### 3.6 Renderer

Keep the Grade shader, so the Library and Grade agree. Build the Library's
pipelines during launch with the asynchronous form, skip scope analysis for
Library draws, and draw a batch of grid cells per frame instead of one at a
time. Confirm the first-draw cause with the stopwatch before changing more.
A separate slim Library renderer is deliberately not proposed: it would be a
second copy of the look that could drift from Grade.

### 3.7 Launch

- Create the window as soon as the app starts, with the Library frame and
  last folder name, while the backend loads.
- Start the helper beside the backend, not after it, and do not hold the
  backend's ready signal for it.
- Load the helper's first-use imports at helper start.
- Show the last folder's remembered listing and cached grid pictures at once,
  then reconcile with a fresh scan.

### 3.8 Opening a photo in Grade (added October 12)

Same principles. The double-click brings Grade to the front at once, with
the loading shown in the status bar. Showing the Library's picture as a
stand-in while it loads is not wanted: after the open reached about 4 s
with an immediate switch, Steve judged it fast enough (October 13). The photo is decoded once (today a photo with a saved grade is decoded
twice), hashed once, and the first frame does not wait for measuring passes
it does not need. measured: demosaic is about 0.9 s of a 4.5 s open; the
rest is measuring passes over the full image. Brief:
`codex-brief-open-in-grade-from-library-2026-10-12.md`.

## 4. Expected result

Estimates, to be replaced by measurements.

| Wait | Now | Target |
|---|---|---|
| 1 First saved grade | 13.7–16.3 s | about 2–3 s |
| 2 Exposure maps, six-photo row | 8–11 s, one stall | immediate for shown pictures; under 2 s otherwise; no stall |
| 3 Launch to first picture | 19.5–21.7 s | window in about 1 s; pictures target under 8 s, firm number after step 0 |
| 4 Fresh folder | 5.9 s first, 6.4 s screen | previews under 1 s; final pictures about 2 s |
| 5 Single, next photo | 2.8–3.5 s | immediate preview; sharp in under 1 s; neighbours immediate |
| 6 Scroll to unseen | 2.5 s | previews under 0.5 s; final pictures about 1 s |

## 5. Build order

Each step is one Codex brief and can be judged by Steve in the app.

0. **Stopwatch and stall.** Stage timestamps for launch, first draw and
   picture requests. Reproduce and fix the kept/check mutual wait.
1. **Saved-grade picture from the open photo** (3.3).
2. **First-draw warm-up, request limit, no discarded decodes** (3.5, 3.6).
3. **Tiers, one open for several products, cache layout, look-ahead**
   (3.1, 3.2, 3.4). The largest step.
4. **Scheduler and helper speed policy** (rest of 3.5).
5. **Launch** (3.7), using step 0's timeline.

Strict areas untouched throughout: CPU export, Proof, pinned shaders,
tolerances, limits and budgets. Step 1 calls the export renderer exactly as
today with a different, already-open source.

## 6. Decisions for Steve

1. Show the camera's embedded picture first, then replace it (3.1).
   **Decided October 12, 2026: yes.** If Steve dislikes the settle, the
   fallback is a fast blur of the embedded picture, wiped away when the full
   picture is ready. Build the replacement so that it can be swapped for that
   transition without reworking the tiers.
2. Use more disk for display-size pictures in exchange for about 1 s per
   Single flip (3.4).
3. Let the helper run at full speed while the Library is in front (3.5).
