# Codex Brief: Build GPU export, GPU Proof and GPU Library pictures now
## HDR Finisher

**Date:** October 18, 2026
**Branch:** `film-look-rebuild`, from its current tip.
**Read first:** `ai/AGENTS.md`; the module PRD
`docs/product/modules/export-and-proof.md` (decisions, state, open work);
the full policy text in `docs/product/archive/HDR_Finisher_PRD_v1.2.md`
section 11d, "GPU delivery implementation policy"; and the earlier brief
`docs/technical/archive/briefs/codex-brief-gpu-export-2026-10-18.md`, whose outcome spec
still applies.

---

## Why this brief exists

Steve thought GPU delivery was finished. It is not. What landed on
October 18 was the plan and its groundwork:

- the approved architecture and perceptual limits, recorded in PRD v1.2 section 11d
  (commit `35b7924`);
- the decoded HDR peak check and the "Guarantee HDR peak" option
  (`1ee57fc`, `3494e65`, `1fc1c41`);
- the perceptual comparison helper (`delivery_colour.py`).

Today export and Proof still render on the CPU. A 45-photo batch is still
about 5,800 s. Saved-grade Library pictures are still made on the CPU in
35 to 60 s each. There is no force-CPU switch. **The plan is approved. Do
not send another plan; build it.**

## Goal

Export (single and batch), Proof and saved-grade Library pictures render
on the graphics card with the same renderer and shaders as the Grade
preview. The CPU is the fallback. Steve gets a build he can try today.

## What is already decided (do not reopen)

From the Export and Proof module PRD (full text in PRD v1.2 section 11d):

- A hidden Electron renderer reuses Grade's renderer and shaders.
- Export resize and output sharpening are part of the shared GPU graph,
  after the creative look and before the final output highlight limiter.
- Preset versions that share rendering reuse the same finished lanes.
- Priority: Grade first, then visible Library pictures (top-left first),
  then background export. GPU work yields between bounded submissions and
  shares one memory budget.
- Closing the last visible window cancels a batch cleanly; finished files
  stay.
- The Library disk picture cache stays, filled from GPU results.
- The perceptual limits: SDR ΔE 2000 and HDR ΔE ITP, mean below 1.0, 99.9th
  percentile at or below 3.0, for GPU against CPU, Proof against export,
  and Library picture against export.
- The exact HDR ceiling: no finished pixel above the highlight target.
  "Guarantee HDR peak" stays an off-by-default preset option, and Library
  pictures never run it.
- Each export result records which renderer made it and, if it fell back,
  why.

## Order of work

Land each step as its own small commit that Steve can try.

1. **Force-CPU switch.** An environment variable and a setting that send
   export, Proof and Library pictures down today's CPU path.
2. **GPU single-photo export** through the hidden renderer, handed to the
   existing encoders. If the GPU is missing, fails or runs out of memory,
   fall back to the CPU and say so in the result.
3. **GPU batch export.** Same queue, results, Pause and Cancel as today. A
   GPU failure mid-batch falls back per photo, and the batch carries on.
   Grade must stay usable while a batch runs.
4. **GPU Proof** from the same finished result as export. Proof falls back
   to the CPU only together with export.
5. **GPU saved-grade Library pictures.** After a paste or a save, each
   changed photo on screen shows its new grade within about 1 s when the
   app is otherwise idle. Include local adjustments and Denoise. Write the
   result into the existing Library disk cache.

If the GPU renderer lacks something export needs, **build it on the GPU**
as part of the step. Stop only if it can't be built without breaking a
constraint below (for example, changing an encoder), and then say why in
plain words.

### Clarification after step 1 (October 18, 2026)

Step 1 landed (`767619c`). Codex stopped at step 2 because Grade's GPU
graph has no delivery resize or output sharpening. That was the brief's
fault: the stop rule was ambiguous. **Building them is part of step 2,
not a reason to stop.** The approved design already says so: "Export
resizing and output sharpening must be included in the shared GPU graph,
after the creative look and before the final output highlight limiter."

- Add delivery resize and output sharpening to the shared GPU graph, with
  the same settings and order as today's CPU export.
- Their result must match the CPU export within the perceptual limits
  (ΔE 2000 / ΔE ITP, mean below 1.0, p99.9 at or below 3.0). Pixel-identical
  is not required.
- Then carry on with steps 2 to 5 without stopping again. Library pictures
  (step 5) need the resize too.
- Testing stays light, as above. Steve tests first.

## Constraints

- Do not change encoders, gain-map maths, file formats, naming, or which
  files a batch writes.
- Do not loosen any existing tolerance.
- Keep the CPU path working, but don't make it faster.
- Never write into the read-only test projects or Steve's photo folders.
- Keep each file's line endings. Commit locally; ask before pushing.

## Testing: deliberately light (Steve, October 18)

Steve will test this build himself first. This overrides the "Still
strict" export testing in AGENTS.md **for this brief only**, at his
request.

- Run the fast checks (`node --test tests/*.test.js` and the `.venv`
  pytest) before each commit.
- Add one small automated check that exports a single small fixture on
  the GPU and on the forced CPU path, and compares them with the existing
  perceptual helper. Also check the decoded HDR peak on that file.
- Do **not** run the focused release check, parity sweeps, timing sweeps
  or the badminton batch. If you want any slow check, ask first.
- Report the limits the small check measured. If it is outside the
  perceptual limits, say so in one line and still hand the build to Steve.

## What to hand back

A short plain-language note for Steve:

- what now runs on the GPU;
- how to force the CPU;
- what to try first (export one badminton photo, run a small batch, open
  Proof, paste a grade in the Library);
- anything that still falls back to the CPU and why.

## Questions protocol

If the code contradicts this brief, stop and say so before working around
it. Do not invent a new architecture. The approved one is in the Export and Proof module PRD. When a step lands,
update that module PRD (Current state, Open work) in the same commit.

## Outcome (October 18, 2026)

Steps 1–5 are implemented in local commits. The current state, small decoded
fixture result, remaining real-photo qualification and Steve's first trial
are recorded in `docs/product/modules/export-and-proof.md`; Library details
are in `docs/product/modules/photo-library.md`. No broader performance or
accuracy claim is made. Testing stayed within this brief's light checks.
