# Codex Brief: harsh-speck colour fix, Denoise baseline, then speed

**Date:** November 19, 2026
**Branch:** start from `feat/denoise-v1` (Clean Grain fixes merged at `395f52e5`).
**Owner:** Steve (not a coder). Report in plain language.

## Where we are

Steve, November 19: "Clean Grain is looking amazing now. Really nice." Fine
Grain and Clean Grain are both very slow, though. Steve wants three steps, in
this order:

1. Fix the harsh-speck colour error.
2. Commit, then record samples of the current Denoise look and speed.
3. Make it faster without losing what we have built.

This brief covers steps 1 and 2 in full and step 3 as a plan only. Do not
start the speed work itself; report the plan first.

## Step 1: Even out harsh specks changes the colour of small lights

**Symptom:** with Even out harsh specks on at ×2.5, a small light on a
railing pole turns a harsh, saturated blue. With it off, the same light is
soft and purplish. Screenshots, from the same view:

- On: `/Users/stevenfuncke/.t3/userdata/attachments/mcp-launch-1e3062f0b0c5ee8fd004b6d058f3254fda6b3cf735f8d4aaa82bddf74453a430-a600ace9-a0c3-475a-af2b-b85b88ad1948.png`
  (top left, the light near y≈90 on the pole)
- Off: `/Users/stevenfuncke/.t3/userdata/attachments/mcp-launch-1e3062f0b0c5ee8fd004b6d058f3254fda6b3cf735f8d4aaa82bddf74453a430-ee8d4b0c-d125-42bb-9c00-a19e8869ce19.png`

The photo is `DSC01212.ARW` in `<photosRoot>/HDR Test Images`. Its thumbnail
matches the tree, lit planter and railing in Steve's Navigate panel.

**Hypothesis (unconfirmed):** the per-phase clamp treats a light only a few
sensor pixels wide as a speck in one colour channel, probably red, and pulls
that channel down. Purple minus red reads as blue. Real light is bright in
all phases at once; a noise speck usually is not. Confirm the cause before
fixing it.

**Expected:**
- Small real lights keep their colour and brightness, within the existing
  finished-pixel limits (SDR ΔE2000 mean < 1, p95 < 3 in a small window
  around each light).
- The specks the control was approved for are still evened out. Keep the
  research counts and marked-spot results within a stated tolerance, and
  report them.
- **Steve's clarification:** keep the existing two-similar-neighbours rule
  and its three-pixel test exactly as they are. Add cross-channel light
  protection alongside it. The protection may only spare existing candidates.
- **Comparison tolerance:** keep at least 95% of both the changed sensor sample
  count and the total absolute sensor correction per noisy reference photo.
  Allow at most one fewer marked colour spot and one fewer marked pit to
  reach grain level per photo and method. Sensor counts include all changes,
  including any real lights the fix should spare. Marks are small integer sets.

This touches RAW development for every photo with the control on: Grade,
Library, Proof and export. Run every check that covers it.

## Step 2: commit, then record the baseline

Commit step 1. Then record the current behaviour of all three methods as the
reference the speed work must keep.

**Photos:**
- the atrium photo from step 1,
- `IMG_0790.CR2` (18 MP Canon),
- `_DSC7970.ARW` (42 MP Sony),
- `DSC05622.ARW`, the marked portrait used as the ordinary photo.

Use Steve's agreed areas and marks in
`codebase/tools/denoise_eval/steve-areas-2026-11-18.json` and
`steve-marks-2026-11-18.json` where they exist. For the atrium and the
ordinary photo, take a few crops at bright lights, shadows and fine detail.

**Pictures:**
- For each photo and method (Standard, Fine Grain, Clean Grain at defaults,
  with harsh specks ×2.5 on), store the finished SDR and HDR crops as the
  reference, plus the scene-referred crops the comparison needs.
- Keep it small, per "Disk space and test output" in AGENTS.md.
- Make one simple review page for Steve, in the round 5 layout: one
  horizontal row per area, methods side by side, at 1:1 Retina.

**Marked-spot numbers:** the colour and pit counts per method, as in round 5
and the Clean Grain fixes round.

**Timings and memory** on the MacBook Neo. Measure the wait the user
actually feels, from the action to the final picture on screen:

| What | Where |
| --- | --- |
| First preparation | at Fit and at 100% |
| Turn on Standard, switch to Fine Grain, then switch to Clean Grain | at 110%, on the atrium, Canon and Sony. Log preparations, cancellations, status and route. |
| Each slider drag | |
| Recalculate | |
| Zoom | 100% to Fit and back |
| Pan | |
| Export | full-size JPEG Ultra HDR |
| Proof | |
| Peak app memory | including the Sony zoom-out that hit 4.55 GB against the 4 GB gate |

Also break the first preparation into its parts: grain fit, each filter
step, writing to disk, upload and drawing. Put the rows in
`docs/technical/performance-table.md`.

## Step 3: speed plan only (report, do not build)

Use the breakdown to propose the cheapest changes that remove the largest
part of the wait, following "Speed where it is felt; the GPU where it pays"
in AGENTS.md. For each change, give:
- the expected new whole wait on the Canon and the Sony,
- the risk to the picture.

**Starting ideas from the last round, not requirements:**
- Reuse finished pixels where filter tiles overlap.
- Retire the old zoom level's GPU buffers before allocating the next one.
- A display-sized drawing surface.
- Moving the colour and grain filters to the GPU, if the numbers justify it.

**Proposed rule for the later speed work:** every faster version must match
the step 2 reference within SDR ΔE2000 mean < 1 and p99 < 3, with HDR ΔE ITP
held to the same limits. The marked-spot counts must not drop. These are the
existing preview/export limits, reused here because the speed work should not
change what Steve sees. Record the rule in the Grade module PRD, then carry on.

The memory gate overrun on the Sony is a real failure on the minimum Mac.
Include its fix in the plan, as the first item.

## Constraints

- Everything in the earlier Denoise briefs still applies:
  - Standard stays pixel-identical, except where step 1 deliberately changes
    harsh-speck output for all methods.
  - Preview, Proof and export agree within the existing limits.
  - HDR never exceeds the highlight compression target.
  - No limit is changed without Steve.
  - One GPU job at a time under the lock.
  - `tools/output_size.py` at the start and the end.
  - Never save over the read-only test projects.
  - Small commits; no push.
- Stop and ask if validation would pass about 30 minutes.

## Report back

In plain language:
- the photo's filename, the cause and fix of the blue light, with the
  before-and-after numbers,
- the link to the baseline review page,
- the timing and memory table, with the preparation breakdown,
- the speed plan, ranked by gain on the whole wait,
- what you ran and what failed,
- your branch and final commit SHA.

Update the user guide (if behaviour changes), the RAW import and Grade module
PRDs, `docs/technical/denoising.md` and the AGENTS.md documentation map in
the same work.
