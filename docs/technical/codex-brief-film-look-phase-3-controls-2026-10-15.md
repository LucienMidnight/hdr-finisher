# Codex Brief: Film Look Rebuild, Phase 3 (Development, Print, Scan and Halation Controls)
## HDR Finisher

**Date:** October 15, 2026
**Branch:** continue on `film-look-rebuild` (after `06875e6`).

## Read first, in this order

1. `ai/AGENTS.md`
2. This brief
3. `ai/docs/product/Film_Look_PRD.md`
4. `ai/docs/product/Film_Look_Rebuild_Plan_2026-10-15.md`, especially section 6
   (every control, old and new), section 8 (phases, including your Phase 1 and 2
   notes) and section 11 (decisions)

Steve owns the project and is not a coder. Write anything addressed to him in
plain language.

## Goal

When Phase 3 is done, Film Look has its real Development, Print and Scan
controls, built on the physical chain from Phase 2. The old hand-built Film
Response controls are gone. Halation keeps its colour controls but loses
Sensitivity. Every control in Film Look does something visible on its own.

The final panel layout is **not** part of this phase (Phase 6; Claude makes a
mock-up first). Put the new controls into the existing panel under simple
headings, in the plan's stage order, so Steve can try them.

## Decisions made since Phase 2 (by Steve, October 15, 2026)

- **D1:** Highlight and Shadow Desaturation leave Film Look. They are not deleted
  as an idea: they come back later as general controls in the main Color section
  (`Open_Items.md`, COLOR-DESAT-01). **Do not build that now.** Just remove them
  from Film Look.
- **D2:** Halation **keeps Hue Offset and Saturation** (Filmbox has both). Only
  Sensitivity is removed.
- **Papers:** ship the three already baked (each stock's default, Kodak 2383,
  Fujifilm Crystal Archive Type II). Do not bake Supra or Ultra Endura.
- **Old projects and old presets:** do not matter. No compatibility code.

## Outcome spec

### Development

| Control | What it does |
|---|---|
| Push/Pull | Development push or pull. **For Portra 800**, +1 and +2 use spektrafilm's measured pushed profiles, and those two entries leave the Stock menu. **For every other stock** it is an approximate change of the film's contrast (spektrafilm's film gamma), and the control says it is approximate (tooltip is enough). Decide sensible steps and range; report them. |

### Print

| Control | What it does |
|---|---|
| Paper | Picker: the stock's own paper (default), Kodak 2383, Fujifilm Crystal Archive Type II. |
| Print Exposure | Brighter or darker print, separate from Film Exposure. |
| Print Warmth, Print Tint, Preflash | Unchanged, now under Print. |
| Print Contrast | The paper's own contrast, on the paper curve. Works on its own (no other slider needs raising first). |
| Shadow Contrast, Highlight Contrast | Contrast of the paper's shadows and highlights separately, following spektrafilm's print-curve morph (fast/slow layer gamma; developer exhaustion for a softer shoulder). Use your judgement on the mapping and explain it. |

### Scan

| Control | What it does |
|---|---|
| Scan Sharpening | The scanner's unsharp mask, as in spektrafilm's scanner stage. Choose the default so it matches what spektrafilm does by default, or report why not. It must not duplicate Detail's sharpening in effect or wording. |
| Lab Levels | spektrafilm's scanner auto black and white levels, on or off. |

### Slides

When a slide stock is selected, the Print controls are disabled with a short
note ("Slides have no print"). Development and Scan still apply.

### Removed

Print Strength, the old Print Contrast, Toe, Shoulder, Color Density, Red, Green
and Blue Response, Highlight and Shadow Desaturation, Halation Sensitivity, and
the unused hidden `reference_model` field. Remove them from the model, the GPU
parameters, the shaders, the CPU path, the presets and the docs. The four
existing Looks (Clean Cinema, Soft Color Negative, Dense Print, High-Speed
Texture) lose those fields; they will look different, and are rebuilt in Phase 5.
Do not try to imitate the removed curve with the new controls.

### Halation

Hue Offset and Saturation stay and keep working. The stock-specific base colour
of the glow is Phase 4; keep today's base colour for now, so Hue Offset 0 and
today's default Saturation look as they do now.

### Names

Show real product names in the Stock menu where spektrafilm's spelling differs,
for example "Fujifilm Superia X-Tra 400". Stock ids and data files stay as they
are.

## Follow-ups from Phases 1 and 2 (check and report; fix only if clearly wrong)

1. **Grain at different sizes.** Phase 2 moved grain inside the film, before
   export resizing, replacing grain synthesized at the delivered size. Check that
   grain looks consistent between the GPU preview at Fit, the preview at 100%, a
   full-size export and a downsized export (for example half size). Grain is
   expected to get finer when an export is downsized, as with a real scan.
   Report what you see, with numbers if you can. If preview at Fit and export
   disagree visibly, stop and report before changing the design. Validate at
   both Fit and 100%: a Fit-only failure has passed the 100% comparison before.
2. **Spatial reach.** The tile reach now adds lens and halation reach (blur reach
   up to 128 instead of 64 quarter-resolution texels). Report in one line what
   that costs in the tiled and viewport paths at maximum settings, and say
   whether Steve should try it in the app.
3. **Table accuracy.** For the 33-point table probe, also report the mean
   difference and which colours give the worst cases, for C200 and Vision3 500T.
   Record it in PRD section 5.1. No change to table size in this phase.

## Constraints

- CPU export and Proof are the exact reference. GPU and CPU must agree at the
  existing tolerances. Do not loosen any check.
- Do not change the stage order from Phase 2, grain, lens diffusion or
  resolution. Bloom & Diffusion stays as it is: it becomes the lens filter in
  Phase 3b.
- No per-stock defaults yet (Phase 4) and no new presets (Phase 5).
- No migration code.
- Keep each file's existing line endings.
- Commit locally in small commits. Do not push. Do not build the installer.

## Testing

As `AGENTS.md` sets out: the fast checks for every change; `film-stock-parity.js`
and `grain-parity.js` once for the group, covering a negative on each of the three
papers, Push/Pull on Portra 800 and on one other stock, a slide, and the new print
and scan controls at their extremes; and the Proof/export group, because export
changes. No full sweep. Stop and ask Steve first if validation looks like more than
about 30 minutes.

## Questions protocol

When something is unclear, or the code disagrees with this brief or the plan,
make the smallest reasonable choice that is easy to undo, note it, and carry on.
Stop only if carrying on could damage export, a pinned check or Steve's data.

## When you finish

End with three parts, in this order.

**1. Report for Steve.** Short, plain language: what he can try in the app and
where, what was removed, what was run and what failed (one line each), and the
commits. Answer the three follow-ups in one or two lines each.

**2. Questions and doubts.** Every decision you made that this brief or the plan
did not cover (Push/Pull steps, the shadow/highlight contrast mapping, the scan
sharpening default, anything odd), each with what you chose and the alternative.

**3. Handoff prompt for the next thread**, which does **Phase 3b (lens filter)**.
It points to the same documents, says what Phase 3 left in place and anything
unfinished, lists open questions that affect it, and asks for the same
three-part ending.
