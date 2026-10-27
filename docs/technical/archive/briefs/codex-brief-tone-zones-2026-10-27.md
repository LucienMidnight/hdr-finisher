# Codex Brief: Tone sliders (Blacks, Shadows, Midtones, Highlights) replace Lift/Gamma/Gain
## HDR Finisher

**Date:** October 27, 2026
**Repository:** `D:\AI\AI Projects\HDR Finisher Tool\ai` (code in `codebase`)
**Start after** the HSL edge-controls brief (`codex-brief-hsl-edge-controls-2026-10-27.md`) is committed.

Read `D:\AI\AI Projects\HDR Finisher Tool\ai\AGENTS.md` first and follow it: testing scale, "Still strict" for export and Proof, perceptual tolerances, line endings (compare with `git cat-file blob`, never `git checkout`), pre-1.0 "no migrations", and plain-language reporting to Steve, who is not a coder.

## Goal

Global Tone gets one clear set of tone sliders in both the HDR and SDR lanes, named and behaving the same way:

- Exposure (unchanged)
- Contrast and Pivot (unchanged)
- **Blacks**
- **Shadows**, **Midtones** and **Highlights**, each with **Center** and **Width**

They replace the Lift/Gamma/Gain group and Tone's "Shadow / Black" (HDR) and "Shadow" (SDR) sliders, which are removed. This is a v1 requirement. The decision and the naming rule are at the top of `docs/product/modules/grade.md` (October 27 tone note). That note is the source of truth.

## Naming rule (Steve's decision, applies app-wide)

- **"Exposure"** is always an equal change in stops: every pixel changes by the same ratio. It is never curved.
- **A tone name is a curve on that part of the range.** Blacks, Shadows, Midtones and Highlights each fade smoothly and leave the other tones alone.
- **Tone ranges are measured in stops from middle grey (0.18)** in both lanes, so a slider means the same thing in HDR and SDR.

## Context

- **Lift/Gamma/Gain today (`_primary_zone_masks` and the primaries code in `adjustments.py`, plus the matching GPU shader):**
  - In HDR, each slider adds stops to a zone with Pivot and Range. Steve wants that targeting kept.
  - In SDR, the maths is display-referred instead: an offset, a power curve, and a gain towards white. This is replaced by the stop-based zones.
- **Tone's dark-end sliders today:**
  - HDR `shadow_lift` multiplies dark pixels.
  - SDR `shadow` adds an offset.
  - Both become **Blacks**.
- **Local adjustments are out of scope.** `LocalGrade` already has Exposure, Blacks, Shadows, Midtones and Highlights in stops with fixed zones (`local_adjustments.py`), and SDR Match fits through them (`sdr_match.py`). Leave both alone. Global's default Center and Width should come close to Local's fixed zones, so the same slider name gives a similar result.
- **Other places that read these fields:** `sdr_match.py`, `library_paste.py`, `range-controls.js`, `gpu-params.js`, `app-state.js`, group presets, Base Rendition and Match.

## Outcome spec

| Control | Range | Behaviour |
| --- | --- | --- |
| Blacks | About ±2 stops | Moves the dark end of the range up or down. Deep shadows follow smoothly. Midtones and above are unaffected. |
| Shadows | About ±2 stops at the zone centre | Brightens or darkens the shadow zone. The deepest blacks stay where they are, which is the recovery behaviour. |
| Midtones | About ±2 stops | Same, for the middle zone. Black and the brightest tones are held. |
| Highlights | About ±2 stops | Same, for the bright zone. The brightest tones (speculars, sun) are left alone, so the peak that Highlight compression measures does not move. |
| Center (per zone) | In stops from middle grey | Moves the zone along the histogram. |
| Width (per zone) | In stops | Widens or narrows the zone. |

**Requirements:**

- **Defaults are exactly neutral.** All amounts at 0 leave the picture unchanged in both lanes.
- **Default zone positions** are sensible for typical photos and close to Local's zones. Report the chosen numbers in plain words, for example "Shadows centres 2 stops below middle grey".
- **Tones never swap order** at any combination of settings, including narrow widths and maximum amounts. This is an existing HDR rule.
- **Highlight compression keeps its exact ceiling,** and its peak measurement sees the new sliders the way it saw the old ones.
- **Histogram feedback.** While dragging any zone slider or its Center or Width, the histogram shows the zone being changed (for example a shaded band). It disappears when the drag ends, and never appears in exports.
- **Panel layout.** Center and Width sit under each zone slider in a compact disclosure that is closed by default. Use existing slider styles and do not restyle the panel. Steve owns the visual design.
- **Tooltips** are short and plain, and follow the naming rule. For example, Shadows: "Brightens or darkens the shadow tones. Black stays black. Center and Width choose which tones count as shadows."
- **Same result everywhere:** GPU first, with the CPU fallback agreeing within the agreed perceptual tolerances. Preview at every zoom, tiles, export, Proof and Library pictures.
- **Old fields are removed:** lift, gamma, gain, their pivots and ranges, `shadow_lift` and SDR `shadow`, along with their code paths and the Lift/Gamma/Gain panel. There is no migration: projects that used them open without those values.
  - **Steve's projects:** before claiming none are affected, search his real projects for these fields and tell him in one line which ones change.
  - **Built-in presets in the repo** that use the removed fields are updated to the new ones.
- **Match, Paste settings, presets, reset and bypass** all work with the new controls. If SDR Match currently writes Lift/Gamma/Gain or Shadow for SDR, have it write the new controls, or nothing, and say which.

## Constraints

- Do not change Exposure, Contrast/Pivot, Exposure Bands, Curves, Color Grading, HSL or Local adjustments.
- Do not add Whites or a Highlight Recovery slider. Highlight compression owns the bright end.
- Do not save over the read-only test projects. Work on copies of photos.
- Commit locally in small commits. Do not push.

## Checks

This changes exported pixels, so it is "Still strict" (AGENTS.md):

- Fast checks (JavaScript and `.venv` Python).
- Result-based tests for:
  - neutral defaults;
  - monotonic output at extreme settings;
  - Shadows leaving the deepest blacks unchanged and Highlights leaving the peak unchanged;
  - Center and Width moving and resizing the zone;
  - GPU/CPU agreement;
  - the HDR ceiling.
- **Existing checks that covered Lift/Gamma/Gain and Shadow:**
  - Update a check whose subject is replaced. Say in the commit what it now expects.
  - Remove a check whose feature is gone, and list it in the commit.
  - Do not loosen any tolerance without Steve's agreement.
- The export/Proof drivers for tone. Add new drivers to `codebase/tests/release/drivers.json`.
- If slow tests will exceed about 30 minutes, stop and ask first (AGENTS.md). Steve prefers to see the review page before the long export runs.

## For Steve's review

Make a page at `D:\AI\AI Projects\HDR Finisher Tool\ai\codebase\output\tone-zones\index.html` (give its full path or a `file:///` link). Use copies of two photos: Balanced Rock, plus one bright sky or sunset. For each, in HDR and SDR, show:

- neutral;
- each slider at +1 and −1 with default Center and Width;
- Shadows +1 with a narrow and a wide Width;
- the histogram band visible during a drag.

## Records and report

- Update `docs/product/modules/grade.md` (mark what is built, keep open items open) and the technical docs that describe tone.
- Move this brief to `docs/technical/archive/briefs/` when done.
- Report to Steve in plain language: what changed on screen, which of his projects look different, what the checks showed, anything unfinished, and any decision he needs to make, one at a time with the trade-off.

## Questions protocol

If anything here conflicts with the existing code, or a requirement cannot be met cleanly, stop and ask before inventing a new pattern. Two examples:
- zones that cannot both leave the ends alone and stay in tone order at extreme settings;
- Match depending on the removed SDR maths.
