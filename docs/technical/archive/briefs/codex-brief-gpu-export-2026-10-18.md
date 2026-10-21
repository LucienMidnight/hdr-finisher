# Codex Brief: GPU Export, GPU Proof and GPU Library Pictures
## HDR Finisher

**Date:** October 18, 2026
**Decision behind it:** PRD section 11d, "Decided (Steve, October 18,
2026): GPU first, including export", and the "GPU first, including
export" section of `ai/AGENTS.md`. Read both first.
**Branch:** continue on `film-look-rebuild` from its current tip.

---

## Goal

Exporting, proofing and making Library pictures should use the graphics
card, the way the Grade preview already does, so that a batch of graded
RAW photos exports in seconds per photo instead of minutes, and a pasted
grade shows in the Library almost at once. The CPU path stays as the
fallback when there is no usable GPU or the GPU fails, and it must keep
working.

Steve has accepted that GPU and CPU results will differ slightly. They
must agree within agreed tolerances, not pixel for pixel. Export and Proof
must still agree with each other.

---

## Why (measured on Steve's machine, October 17 to 18)

Steve's real job: 45 Sony ARW photos (`D:\Photos\2026\20261017
badminton`), one grade pasted onto all of them, with a film stock, grain
and Denoise.

| Work | Today (CPU) | Notes |
| --- | --- | --- |
| Batch export, 45 photos | about 5,800 s estimated (about 130 s per photo) | Profile: almost all in `film_stock.py` (print and scan density lookups) and Denoise at full size |
| One Library saved-grade picture (2560 px edge) | 35 to 60 s each: 5 to 13 s RAW decode, 25 to 51 s render, 2 to 7 s encode | Made one at a time; the 15th photo after a paste waited about 12 minutes |
| Grade preview of the same photo | interactive | Already on the GPU |

`backend.log` events `kept_source_ready`, `kept_rendered`, `kept_encoded`
and `kept_picture_saved` hold these timings; use the same events to
measure the result.

---

## What already exists

You know the code better than this brief does; confirm before relying on
any of it.

- The WebGPU renderer in the app window (`webgpu-preview.js`,
  `webgpu-shaders.js` and the `gpu-*.js` files) already draws the whole
  look: film stock, grain, halation, Denoise, local adjustments and masks,
  geometry, lens corrections, tiled full-resolution rendering.
- The Library has its own GPU renderer built on the same class and shaders
  (`library-gpu.js`, `HDRLibraryGPU extends HDRWebGPUPreview`). Today it
  draws the default look of unedited photos. For edited photos it waits for
  CPU-made saved-grade pictures, because its drawing path does not include
  local adjustments or Denoise analysis.
- Parity checks already compare GPU and CPU for many stages
  (`film-stock-parity.js`, `grain-parity.js`, `denoise-adaptive-parity.js`,
  `lens-filter-*-parity.js`, `bw-parity.js`, `sdr-gamut-gpu-parity.js`,
  `gpu-highlight-compression-parity.js`, `test_export_denoise_parity.py`,
  and others). Their tolerances are the starting point for item 4.
- Encoding (JPEG Ultra HDR, AVIF and JPEG XL gain maps, SDR formats, gain
  map computation, metadata) lives in the Python backend.
- Batch export runs in a separate below-normal-priority Python process per
  photo, with no access to the GPU.

---

## Outcome spec

### 1. GPU export (single photo and batch)

- Each exported photo is rendered on the GPU at full output size, using the
  same renderer as the Grade preview, then handed to the existing encoders.
  One render serves every version of a preset that shares the same
  rendering (for example HDR AVIF and SDR JPEG need the HDR and SDR lanes,
  not two full renders each).
- Output files, formats, naming, sub-folders, metadata, results list,
  Pause, Cancel, progress and per-photo progress behave exactly as today.
  Only the rendering moves.
- Grading stays usable during a batch. A batch must not make Grade stutter
  badly; say how you share the GPU between them.
- Where the GPU render runs (the main window, a hidden window, a backend
  GPU path) is your choice. Explain it in plain terms for Steve, including
  what happens if he closes the main window during a batch.
- If the GPU is missing, out of memory, or lost mid-batch, that photo falls
  back to the CPU export and the batch continues. The results list says
  which photos used the CPU and why.

### 2. GPU Proof

Proof shows the same pixels the GPU export would write for that photo and
those settings, within the export/Proof tolerance (item 4). Proof falls
back to the CPU together with export, never separately, so the two never
disagree.

### 3. GPU Library pictures (the thumbnail problem)

- After a paste, or a save in Grade, the Library shows each changed photo
  with its new grade within about **1 second of it being on screen**, when
  the app is otherwise idle. Photos on screen come first, top-left first.
- The full saved-grade look, including local adjustments and Denoise, is
  drawn on the GPU. If the CPU-made picture is still useful as a cache
  between sessions, keep it; otherwise say so and propose removing it.
- The "Updating" and "Paused" tile labels keep their meaning.

### 4. Tolerances (agree before measuring)

Per AGENTS.md "Work within tolerances": before building, propose one
tolerance per comparison with a one-line reason, record them in the PRD
(section 11d), and then work within them without coming back to Steve.

| Comparison | Starting point |
| --- | --- |
| GPU export against CPU export (the fallback) | the existing GPU/CPU parity tolerances for each stage; propose one whole-image figure on top |
| GPU export against GPU Proof | should be identical or extremely close; propose |
| GPU Library picture against GPU export at the same size | propose |

Use Steve's badminton photos (read-only) and the read-only test projects
for the measurements. Never save over either.

### 5. CPU fallback

Steve's words: "cpu fallback should work before we do gpu". It works
today; keep it working. Make it easy to force the CPU path (a setting or
an environment variable) so Steve and the tests can compare the two. Do
not spend effort making the CPU path faster.

---

## Constraints

- Do not change encoders, gain-map maths, file formats, naming, or what
  files a batch writes, except where rendering on the GPU forces it. Say
  so if it does.
- Do not loosen any existing parity tolerance without Steve (AGENTS.md
  "Changing tests"). New GPU-export tolerances are proposed and recorded
  as in item 4.
- Keep each file's line endings (AGENTS.md).
- Commit locally in small commits. Ask before pushing.

## Testing (scaled per AGENTS.md)

- Fast checks after each change.
- The parity checks that cover each stage you route through GPU export.
- One new check that exports a small batch on the GPU and compares it with
  the CPU fallback within the agreed tolerance, and one that forces the CPU
  path and confirms it still exports.
- Timing: the badminton batch (or a 10-photo subset of it) on GPU against
  the CPU numbers above, and Library picture latency after a paste.
- This is a release-sized change. Before the focused release check, give
  Steve the estimate and ask (AGENTS.md "Stop and ask").

## Plan first

This is large. Before writing code, report back with:

1. where the GPU export will run and why,
2. how batch export, Proof and Library pictures share the GPU with Grade,
3. the proposed tolerances, and
4. a rough order of work and size.

Steve will read the plan, so write it in plain language.

## Questions protocol

If the code contradicts anything here, or the GPU renderer turns out to
lack something export needs, stop and say so before working around it.
