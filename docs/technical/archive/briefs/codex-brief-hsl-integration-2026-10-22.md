# Codex Brief: Build HSL into the app (global and local)
## HDR Finisher

**Date:** October 22, 2026
**Branch:** a new branch from `main` (for example `hsl`). Commit locally in
small steps; ask before pushing.
**Module PRD:** `docs/product/modules/grade.md`. Update its current state
and open work as each part lands; move this brief to
`docs/technical/archive/briefs/` when done.
**Design reference:** the prototype in `codebase/tools/hsl-prototype/`
(your engine and shader, Claude's front end, commits `6725f3c`, `a80493c`,
`d6ecf12`). Its README holds the engine contract. Run it with
`node tools/hsl-prototype/launch.cjs` from `codebase`.

## Goal

Steve can use HSL in the real app for his next test session: pick colours
on the photo, change their hue, saturation and luminance, and see the
result in the preview, in Proof and in exported files. It works in the
global grade (HDR and SDR, each with its own settings) and inside every
local grade. It saves with the project, works with presets, copy/paste and
undo, and looks and behaves like the prototype panel.

Claude does a design pass in the real app after this lands, so aim for the
prototype's behaviour and layout in the app's own visual style. Pixel-level
polish is not needed.

## Decisions already made (Steve, October 22, 2026)

| Topic | Decision |
|---|---|
| Global layout | DxO-style channels: **All** plus eight bands (red, orange, yellow, green, aqua, blue, purple, magenta), each with its own range and its own Hue / Saturation / Luminance / Uniformity / Amount. Up to four **Custom** channels hold any multi-colour pick. |
| Local layout | Each local grade has **one** HSL selection, which can include several colours and exclusions, with one set of sliders. The eight band colours are quick starts. It applies inside that local grade's mask. |
| Global placement | After **Primaries**, before **Curves**, in both the HDR and SDR grades. Colours are chosen after exposure and white balance; Curves and Color Grading act on top. |
| Local placement | Inside each local grade, in the same relative position (before the local grade's curves/colour-grading-style controls). Propose the exact spot if the local stack differs. |
| Who does what | You build the integration end to end, panel included. Claude then does a design pass. |
| Colour model | Your Oklab/OKLCh engine from the prototype, unchanged in behaviour. It is not DxO's algorithm and does not need to be. |

## Outcome spec

### Processing

- Global: every channel with an effect is measured from the **same stage
  input**, and the effects combine. The prototype adds them
  (`in + Σ(channel(in) − in)`); keep that unless you see a reason not to,
  and tell Claude if you change it. Run all channels in **one** GPU pass,
  not one pass per channel.
- A neutral HSL section (every channel at zero, or the section off) leaves
  pixels exactly unchanged, on the GPU and the CPU, so existing projects
  render and export exactly as before.
- Selection follows the prototype: included ranges combine by maximum,
  exclusions by maximum, near-grey colours are protected, and the selection
  does not change with exposure.
- Bands start with the prototype's default centres and widths (centres
  measured in Oklab hue from representative colours; core width 35% and
  feather 50% of the gap to the nearer neighbour). The All channel covers
  every hue.
- The engine works in D65 linear sRGB, as the README says. Use the app's
  approved conversion into and out of it. Never pass ACEScg values in
  directly.
- HDR values above 1 and negative channels pass through correctly. The
  final HDR highlight ceiling still applies after HSL.
- Preview runs on the GPU through the app's existing device, buffers and
  device-loss handling, not the prototype's private device. The CPU path
  (Python) is the fallback and is what export and Proof use until GPU
  export covers this stage. Both must agree (see Testing).

### Saved settings

- Global HSL: an HDR copy and an SDR copy, each with an on/off switch like
  the other sections, the channel list (All, eight bands, Custom channels)
  and each channel's ranges and sliders.
- Local HSL: one selection plus sliders in every local grade.
- Pre-1.0 rule: no migration code. A project without HSL opens with HSL
  neutral.
- Pick the schema shape and the limits on ranges (per channel and in total)
  to suit the GPU parameter layout. Tell Claude the limits. The panel must
  say clearly when a limit is reached, never drop a pick silently.

### Panel (global)

Follow the prototype, inside a normal Grade control group with the app's
header (section on/off, **Preset**, **Reset**).

| Element | Behaviour |
|---|---|
| Channel strip | All (spectrum swatch) and eight colour swatches in one row; Custom channels on a second row as named pills, plus "+ Custom". A small dot marks every channel that differs from its default. |
| Channel title row | Channel name, "N in · M out", **Reset channel**, and **Delete** for Custom channels. |
| Wheel | Outer ring = source hues, dimmed outside the current channel's selection. Inner ring = what each hue becomes after all of HSL. Every range of the current channel has a centre point on the ring (excluded ranges sit inside the ring). The selected range also has two edge bars (each moves one edge; the other edge stays put) and two softness dots. The inner dot is the hue-shift target. |
| Wheel gestures | Click a point to select its range, drag to move it. **Right-click** a point, or press Delete, to remove its range, as with path nodes and curve points. A band always keeps at least one included range. Every handle works from the keyboard (arrows; Shift for 5°). |
| Picker | Pick / Add / Subtract buttons below the wheel. Click or drag on the main preview. Pick replaces the channel's ranges; Add and Subtract add ranges; a drag collects several colours. Picking while All is selected creates a new Custom channel. Samples too grey to have a hue give a short message. |
| Sliders | Range and Softness for the selected range, then Hue, Saturation, Luminance, Uniformity, Amount. Use the app's slider controls; double-click resets, as elsewhere. |
| Show selection | A way to show the current channel's selection on the preview (the prototype dims everything outside it). Use the app's existing mask-overlay or view mechanism if one fits. |

### Panel (local grade)

The same wheel, picker and sliders inside the local grade's controls, with
no channel strip. The eight band swatches are quick starts (Pick sets the
selection to that band; Add and Subtract add it). Picks sample the local
grade's own stage input.

### Picker sampling

Global picks sample the HSL stage input (what HSL receives); local picks
sample the local grade's stage input. Use a 5×5 neighbourhood average in
linear light, as the prototype does. Your design for how the panel gets
those pixels.

### Everything that carries grade settings

HSL behaves like the other Grade sections in each of these:

- **Undo:** one undo step per gesture (a picker drag, a wheel drag, a slider
  drag).
- **Presets:** the Adjustment Presets dialog, with HDR and SDR group ids
  like the other sections. No built-in presets are needed.
- **Copy/paste, Library paste and saved grades:** HSL is included wherever
  the other sections are.
- **HDR→SDR Match:** treat HSL the way Color Grading is treated there. If
  that is unclear, ask before choosing.
- **Before/after and section bypass:** work as for other sections.

## Constraints

- Export and Proof output is strict territory under AGENTS.md. With HSL
  neutral, exported files must not change. With HSL active, export and
  Proof must match the preview within the agreed perceptual tolerance.
- Do not change other sections' behaviour, order or tolerances.
- Do not extend the prototype or keep a second copy of the engine. The app
  gets the engine, and the prototype stays as it is until Claude's design
  pass is done (Steve will decide when to delete it).
- The **hue-selection mask leaf** (required for v1, Grade open work item 8)
  is **not** part of this brief. Keep the selection code reusable for it,
  because it will share the same selection and wheel later.
- Use the app's tokens, controls and dialog patterns. Don't add new design
  tokens without asking.

## Testing (per AGENTS.md)

- Fast checks: `node --test tests/*.test.js` and the `.venv` pytest.
- Port the prototype's engine behaviour tests to whatever modules now hold
  the engine (JS and Python): separated ranges, exclusions, red wrap,
  feathering, exposure-independent selection, grey rejection, sampling,
  uniformity, channel combination, and neutral = exact passthrough.
- One GPU driver for HSL in the app: preview on the GPU against the CPU path
  using the app's perceptual image tolerance (ΔE 2000 for SDR, ΔICtCp for
  HDR: mean below just-noticeable plus a high-percentile limit), the HDR
  ceiling, and the main panel interactions (pick, add, subtract, wheel drag,
  right-click delete, channel switch, undo, preset apply, local grade).
  Register it in `tests/release/drivers.json`.
- Run the existing export/Proof checks that cover Grade colour stages once,
  at the end, to show neutral HSL leaves output unchanged.
- If validation will take more than about 30 minutes of slow tests, stop
  and tell Steve first.

## Report back

In plain language for Steve: what works, what was run, anything left open.
For Claude: the schema shape, range limits, where the panel code lives, and
anything in the prototype's behaviour you changed and why.

## Questions protocol

If anything here conflicts with the existing code (stage order, preset
paths, Match handling, local-grade structure), ask before building around
it. Don't invent new patterns where the app already has one.
