# Brief: a fast Film Look, the same in preview and export (November 28, 2026)

Approved by Steve on November 28, 2026, as option 3 of the Film research. Built on its own
branch `film-fast-look`, separate from the cleanup sprint. It changes the final look
on purpose, so Steve reviews before/after crops before anything is merged into main.
He will also test it on the PC's large screen.

Read `ai/AGENTS.md`, `docs/product/modules/film-look.md` and the two research reports first:
- `docs/technical/research/film-speed-2026-11-28/sol-report.md` (measured)
- `docs/technical/research/film-speed-2026-11-28/neon-report.md` (design survey, estimates)

## Why
Steve uses Film Look on almost every photo. He wants sliders to feel realtime: about
100–200 ms from slider movement to preview update **in total**, with modules stacked.
Today, on the MacBook Neo at Fit with Portra 400, Black Pro-Mist, Halation and Grain:
- Exposure drag with Film on: the first GPU frame is ready after about 0.17–0.2 s, but
  the frame still current at the next frame comes after about 1.0 s, and settle takes 0.76 s.
- Measured GPU cost (Sol trace, 24 MP Fit):
  - Mist rebuild on any upstream change: 108–134 ms per frame (27 Gaussian components,
    54 passes).
  - Full Grain finish on release: 490–552 ms (up to 16 samples per pixel).
  - Halation: about 3 ms. Scan: 2–3 ms. These are not the problem.

## Steve's direction (binding)
- **No visible draft-then-swap.** Dragging, settled preview, Proof and export show the same
  Grain and Mist. A different sample budget between drag and release is not allowed.
- **Artistic, not physical.** Lower accuracy is fine when the result still looks like
  good film grain and good diffusion. Describe the visible change honestly.
- If one effect stays heavy after this work, leaving it out of presets with a warning is
  an acceptable fallback. Report it rather than forcing it.

## Packages

### F1 · Grain (one worker)
Replace the per-pixel multi-sample physical Grain with a consistent, fast grain field.
- One design used everywhere: GPU Direct and Tiled at every zoom, Proof, GPU export and
  CPU export (`backend/hdr_finisher/film_grain.py`, `grain_work.py`).
- The field is anchored to image coordinates and a fixed seed, so it doesn't crawl
  during drags or differ between tiles. It is filtered to the pixel footprint, so Fit,
  100% and export at any size show the same character. No visible tile repetition.
- Calibrate against today's Grain so a user sees "the same grain, slightly different
  specks": RMS and contrast per tone level, spectrum and size response, chroma, and the
  stock and size sliders. Keep where Grain sits in the processing order.
- Target: Grain ≤ 25 ms GPU at Fit on 24 and 50 MP. Report 100% and export time.

### F2 · Mist / lens diffusion (one worker)
Replace the 27-component Gaussian mixture with about 6–8 calibrated lobes.
- Fit the lobes per filter type and strength against today's point-spread so halos,
  veil and highlight bloom look the same to the eye. Keep the narrowest lobe at or near
  pixel resolution, or fold it into the sharp source. Wider lobes may run on cheaper
  levels (pyramid) if the compact fit alone isn't fast enough.
- Same design in GPU Direct and Tiled, Proof, and GPU and CPU export
  (`backend/hdr_finisher/lens_filter.py`). Tile halos must still cover the reach.
- Target: Mist miss ≤ 25 ms GPU at Fit on 24 and 50 MP. Report 100% and export time.

### F3 · Review crops and measurement (coordinator)
- Before/after crops in one small review page under
  `codebase/output/review/film-fast-look/`: fine grain in flat areas and skin, halos
  around hard edges and specular points, dark lines next to highlights, and mixed-colour
  highlights. Use 2–3 test photos and the common stocks. Keep it small (downscaled crops).
- Re-run `grade-module-impact.js --module film` on typical and large at Fit, and large at
  100%, and compare `first_frame_ms`, `first_feedback_ms` and settle with the sprint
  re-audit.

## Acceptance
- Film adds ≤ 100 ms to first frame and to settle at Fit on both photos, measured with
  the audit driver. Report honestly if it doesn't.
- CPU and GPU export agree within the existing tolerances. Never loosen a tolerance,
  limit or the pinned lens/Velvia caps in `tests/helpers/film-parity-limits.cjs`. If an
  intended look change makes a stored reference obsolete, regenerate that reference and
  say so in the commit. A cap needing to rise is a stop-and-ask for Steve.
- HDR output never exceeds the Highlight Compression target (the one exact rule).
- Export and Proof are strict: run every check covering Film delivery:
  - `film-stock-parity.js`
  - `tiled-film-parity.js`
  - `local-detail-film-parity.js`
  - the lens-filter checks
  - the grain checks
  - the HDR ceiling delivery check
- Separate commits per package, each one undoable alone. No push or merge into main.

## Rules
- Each worker works in its own worktree on a branch from `film-fast-look`.
- Every GPU or Electron run goes through `tools/gpu-run-lock.py` with
  `HDR_FINISHER_ELECTRON_WINDOW_SIZE=1408x794`, from `codebase`.
- Codex sessions sometimes crash. Keep notes in the package's notes file as you go, and
  commit working steps early.
- Memory: follow `docs/product/modules/memory-and-caches.md`. Any new texture or cache
  is small and bounded, and you state its size.
