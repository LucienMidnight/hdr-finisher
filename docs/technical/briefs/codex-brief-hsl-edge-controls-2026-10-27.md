# Codex Brief: HSL selection edge controls (Edge, Feather, Edge detail)
## HDR Finisher

**Date:** October 27, 2026
**Repository:** `D:\AI\AI Projects\HDR Finisher Tool\ai` (code in `codebase`)

Read `D:\AI\AI Projects\HDR Finisher Tool\ai\AGENTS.md` first and follow it: testing scale, "Still strict" for export and Proof, perceptual tolerances, line endings (compare with `git cat-file blob`, never `git checkout`), and plain-language reporting to Steve, who is not a coder.

## Goal

Give Steve three controls that shape the edge of an HSL colour selection, so he can fix rims, halos and leftover specks around a selected object himself:

- **Edge**: pushes the selection boundary outward (grow) or inward (shrink).
- **Feather**: softens the boundary.
- **Edge detail**: sets how closely the selection follows light and dark edges in the picture, from smooth (ignores edges) to tight (hugs them).

They work on Global HSL (per channel) and on the Local hue mask (per hue leaf), through the one shared selection both already use.

## Context

- Global HSL and the Local hue mask share one selection engine: GPU `codebase/frontend/hsl-selection-gpu.js`, CPU reference `codebase/backend/hdr_finisher/hsl_selection.py`. It selects from the picture just before HSL: coarse smoothed chroma on a frame-anchored grid, then a luminance-guided filter at full resolution.
- Today's guided-filter strength is fixed. The bright-spot "protection" was removed today (commit 4d3757d); its slot is still in the guide texture and its surround radius is still in `reach`. Reuse or remove them as you see fit.
- Distances are authored in source pixels and converted by the processing scale, so Fit, every zoom, tiles and export select the same area. Keep that true for the new controls.
- Tiles get a halo from the selection's `reach`. Earlier today a missing halo produced a visible horizontal line at 423% (fixed in b08d47d; reproduce with `codebase/tools/hsl-seam-repro.js`). Any new spatial reach must be included in the tile halo, the Local hue mask's band overlap and the memory planner.
- Module PRD: `docs/product/modules/grade.md` (top notes describe today's state). Technical notes: `docs/technical/local-adjustments.md`.

## Outcome spec

| Control | Where | Range and units | Default | What the user sees |
| --- | --- | --- | --- | --- |
| Edge | Global HSL channel controls, below Softness; Local hue-mask controls | Signed, about -8 to +8 source pixels | 0 | Positive grows the selected area so rims around the subject are included; negative shrinks it off neighbouring objects. |
| Feather | Same | 0 to about 16 source pixels | 0 | Softer transition at the boundary with no visible steps, rings or blocks. |
| Edge detail | Same | 0 to 100 | Today's result | Low: selection flows smoothly across texture and small bright or dark specks. High: selection hugs light and dark edges more tightly. |

Requirements:

- **Defaults reproduce today's selection.** Existing pictures and exports must not change until a control is moved.
- **Same result on every route:** preview at every zoom, tiles, Show selection, Local Show mask, export, Proof, Library pictures, and the CPU fallback. No seams at tile joins at any setting.
- **Interactive speed:** dragging these sliders should feel as live as dragging Range today. A change to these controls should not redo the range-independent preparation. Propose a timing tolerance before measuring (AGENTS.md "Work within tolerances").
- **Show selection** (Global) and **Show mask** (Local) reflect all three controls.
- **Saved projects:** the new values are saved with the recipe or leaf. Pre-1.0 rule: no migration code; missing fields mean defaults.
- Edge interacts sensibly with subtracted ranges and the neutral floor. Grow and shrink must not create selection in areas the user excluded with a subtracted range. If that is not achievable cleanly, ask.
- Labels and tooltips are short and plain, in the style of the existing HSL controls. Steve owns the visual design of the panel; keep to existing slider styles and do not restyle the panel.

## Constraints

- Do not change how HSL Luminance, Hue or Saturation are applied (their response curves). Steve is discussing a curved Luminance response separately.
- Do not change the coarse chroma grid, the frame anchoring or the source-pixel scaling, beyond what these controls need.
- GPU first; the CPU is the fallback and must agree within the agreed coverage tolerance used by `tests/hsl-selection-engine.js`.
- Keep the Highlight compression ceiling exact (no finished HDR pixel above the target).
- Do not save over the read-only test projects. Work on copies of photos.
- Commit locally in small commits. Do not push.

## Checks

Follow AGENTS.md. This touches export and Proof output, so it is "Still strict":

- Fast checks (JavaScript and `.venv` Python).
- `node tests/hsl-selection-engine.js` (run natively), extended to cover non-default Edge, Feather and Edge detail on the full frame, a halo tile and half scale.
- `tests/hsl-selection-delivery.js` and `--local`, `tests/hue-mask-delivery.js`, with non-default values of the new controls included.
- `tools/hsl-seam-repro.js` with non-default values: no row or column jump at tile joins.
- Add any new driver to `codebase/tests/release/drivers.json`.
- Tests check results (coverage, pixels, saved files), not wording.

## For Steve's review

Make a page at `D:\AI\AI Projects\HDR Finisher Tool\ai\codebase\output\hsl-edge-controls\index.html` (give its full path, or a `file:///` link, in the report). Use a copy of Balanced Rock, SDR, Yellow 15/21, the bush at 423%, with Luminance -2 EV and +0.8 EV. Show HSL off, then defaults, then Edge -3/+3, Feather 6, and Edge detail low/high. Include Show selection for the same settings.

## Records and report

- Update `docs/product/modules/grade.md` (what is built, the decisions above, what is open) and `docs/technical/local-adjustments.md`.
- Move this brief to `docs/technical/archive/briefs/` when done.
- Report to Steve in plain language: what he can now do, what the checks showed, anything not finished or not verified, and any decision he needs to make, one at a time with the trade-off.

## Questions protocol

If anything here conflicts with the existing code, or a requirement cannot be met cleanly (for example, grow against subtracted ranges, or interactive speed at large Feather), stop and ask before inventing a new pattern.

## Implementation timing tolerance

Proposed before measuring: edge-control selection edits within 20% of Range edits,
with a 10 ms allowance for short runs (GPU queue/readback noise and added bounded
passes). Preparation must remain cached. Existing coverage and delivery tolerances
are unchanged.
