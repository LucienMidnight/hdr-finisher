# Codex Brief: Clean Grain fixes after Steve's first app test

**Date:** November 19, 2026
**Branch:** start from `feat/denoise-v1` (experimental methods merged at `39724a2d`).
**Owner:** Steve (not a coder). Report in plain language.
**Builds on:** `docs/technical/archive/briefs/denoise-experimental-grain-modes-2026-11-19.md`.

## What Steve found (November 19, app test on the Canon IMG_0790.CR2)

- **Pixel cleanup** ("Even out harsh specks") works well.
- **Fine Grain** is "really good at preserving texture while still greatly
  reducing noise". Some bright edges stand out more. The coloured fringe
  along the lit planter edge is one example.
- **Clean Grain** fixes those edges but causes artefacts of its own:
  1. **Halos around specular highlights.** At 609% a bright light gets a
     dark green ring about 12 photo pixels out. The ring matches the Small
     reach.
  2. **Colour changes in broad bright areas.** Real colour detail around
     the lights and on lit surfaces changes noticeably, and the foliage
     loses colour variety.
  3. **Dark Specks** treats ordinary shadows as clumped specks. Steve found
     0% better than any other amount.
  4. **Splotch Size Small** gave fewer artefacts than Large.
- **UI:** the Dark Specks slider draws its blue fill from the thumb to the
  right end (from 2% to 100%). The other sliders draw no fill.

Screenshots (same view, no slider changes between them):

| Screenshot | Settings |
| --- | --- |
| `/Users/stevenfuncke/.t3/userdata/attachments/mcp-launch-1e3062f0b0c5ee8fd004b6d058f3254fda6b3cf735f8d4aaa82bddf74453a430-b2cbd9fb-f510-4ff7-b610-e55d929b0a66.png` | Clean Grain, Splotches 100%, Small, Specks 2% |
| `/Users/stevenfuncke/.t3/userdata/attachments/mcp-launch-1e3062f0b0c5ee8fd004b6d058f3254fda6b3cf735f8d4aaa82bddf74453a430-fde0b480-9d64-4aa0-ad0f-a9c53fb24fab.png` | Fine Grain |
| `/Users/stevenfuncke/.t3/userdata/attachments/mcp-launch-1e3062f0b0c5ee8fd004b6d058f3254fda6b3cf735f8d4aaa82bddf74453a430-15634b14-7868-46fe-b148-bb019dbe23e4.png` | Standard |

## Goal

Clean Grain should remove the colour splotches and the edge colour that
Fine Grain leaves. It should stop creating halos or changing real colour.
Fine Grain itself stays as it is.

## Outcome spec

### 1. No halos around bright lights

A very bright light, specular highlight or clipped area must not decide the
colour of the dark pixels around it. Colour cleanup near a light should
behave as it does in a flat dark area with no light nearby.

**Measure:** find the 20 brightest small highlights on the Canon and on the
Sony. In a ring 3–20 px around each one, compare Clean Grain with Fine
Grain. The proposed limit is SDR ΔE2000 mean < 1 and p95 < 3, the same
just-noticeable limits the app already uses for preview against export.

### 2. Real colour stays

Colour cleanup should act on blobs that differ from their surroundings by
about the size of a splotch: a few times the leftover grain. It should
leave much larger colour differences alone, because those are real objects
or edges. The coloured fringe along bright edges should still be cleaned,
as it is today. That fringe is the main reason Steve wants Clean Grain.

**Measure:**
- **Splotches still removed:** with Splotch Size Small at the default
  strength, at least 20 of 28 Canon colour marks and 22 of 24 Sony colour
  marks reach grain level. This uses the same marks and measurement as
  round 5 (`codebase/tools/denoise_eval/steve-marks-2026-11-18.json`).
- **Real colour untouched:** Clean Grain must not visibly change Steve's
  detail areas: flame, faces, eye and lashes, hair, skirt. Compare against
  Fine Grain with the same ΔE limits, and report each area.

### 3. Dark Specks: one attempt, otherwise remove

- Dark Specks defaults to **0%**.
- Make **one** attempt to restrict it to isolated dark clumps: small,
  darker than surroundings that are brighter on all sides. Ordinary shadow
  texture, shadow edges and dark detail must not be touched.
- **Success:** at least 10 of 12 Canon pits and 4 of 5 Sony pits reach
  grain level, and ordinary shadow areas stay within the ΔE limits above
  against Fine Grain.
- If the attempt misses that, remove the Dark Specks control and its
  preparation, and report what was tried. Clean Grain then becomes
  colour cleanup only.

### 4. Defaults and UI

- Splotch Size defaults to **Small**.
- Fix the Dark Specks slider fill so it looks like the other sliders. If
  the control is removed, check that nothing is left behind.

### 5. Fine Grain bright edges (investigate only)

Compare Fine Grain with Standard along bright edges. An example is the lit
planter edge in the screenshots. Report whether Fine Grain makes coloured
or bright edges stronger than Standard does, or only keeps more of what was
already there, and what could fix it. Do not change Fine Grain in this
round.

## Constraints

- Everything in the earlier brief still applies:
  - Standard stays pixel-identical.
  - Preview, Proof and export agree within the existing Denoise limits.
  - HDR output never exceeds the highlight compression target.
  - MacBook memory limits; the GPU lock; no per-camera tuning; no TAU
    bm3d/bm4d packages.
  - Design tokens only.
  - Never save over the read-only test projects.
  - Small commits; no push.
- Don't fix the halo by blurring colour more widely or by removing the
  edge-fringe cleanup.
- Report the MacBook preparation, recalculate and export times only where
  they move by more than 10%.

## Testing

Use the fast suites and the Denoise GPU and delivery checks that cover the
change, as in the earlier brief. Stop and ask if slow validation would
pass about 30 minutes.

## Report back

In plain language:
- what Steve will see differently,
- the halo, splotch and detail numbers, against Fine Grain,
- what happened to Dark Specks: kept or removed, and why,
- the Fine Grain edge finding,
- what you ran and what failed,
- your branch and final commit SHA.

Update the user guide, the Grade module PRD, `docs/technical/denoising.md`
and the AGENTS.md documentation map in the same work.
