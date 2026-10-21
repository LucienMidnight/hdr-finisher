# Codex Brief: Film Look Rebuild, Phase 3b (Lens Filter)
## HDR Finisher

**Date:** October 15, 2026
**Branch:** continue on `film-look-rebuild`, after Phase 3 is finished.

## Before you start

Phase 3b starts only when Phase 3 is complete: the Fit grain fix from the
Phase 3 brief's addendum is in and its pass/fail check passes, and the
Development, Print, Scan and Halation controls are built. If either is not done,
finish Phase 3 first (`codex-brief-film-look-phase-3-controls-2026-10-15.md`),
then come back here.

## Read first, in this order

1. `ai/AGENTS.md`
2. This brief
3. `ai/docs/product/modules/film-look.md`
4. `ai/docs/product/archive/Film_Look_Rebuild_Plan_2026-10-15.md`, section 6 (the Bloom
   row) and your notes from Phases 1 to 3 in section 8
5. spektrafilm's lens diffusion model: `src/spektrafilm/model/diffusion.py`
   (`apply_diffusion_filter_um`, the filter-family table) and
   `DiffusionFilterParams` in `runtime/params_schema.py`, at the pinned revision
   `3bb2c2d` used for Phases 1 to 3

Steve owns the project and is not a coder. Write anything addressed to him in
plain language.

## Goal

Bloom & Diffusion becomes a real lens diffusion filter, as in spektrafilm: the
user picks a filter type and a strength the way a photographer picks a physical
filter, and the glow comes from light spreading in front of the film. The film
curve then shapes it (Phase 2 already runs this stage before the negative).

## Outcome spec

| Control | What it does |
|---|---|
| Filter | Type: None, Black Pro-Mist, Pro-Mist, Glimmerglass, CineBloom (spektrafilm's families; follow its list if it differs and say so). None is a true bypass. |
| Strength | In commercial filter grades: 1/8, 1/4, 1/2, 1, 2, with in-between values, as spektrafilm maps them. |
| Size | spektrafilm's spatial scale: makes the whole glow larger or smaller. |

- Removed: Bloom Amount, Sensitivity, Optical Spread, Highlight Detail, and the
  Bloom on/off switch (Filter: None replaces it). Remove them from the model, GPU
  parameters, shaders, CPU path, presets and docs.
- The filter works on the film plane, so its size follows Film Format like
  halation and grain do (today's bloom is measured against the output instead).
- The filter spreads light without adding energy, as spektrafilm's does. In HDR,
  bright highlights spread, but overall highlight ratios must stay believable;
  check an HDR picture with bright highlights, and report what you see.
- spektrafilm also has finer controls (halo warmth, separate core/halo/bloom
  sizes and strengths). Do not add them. Recommend whether one of them, for
  example halo warmth, is worth exposing later, and why.

## Constraints

- **Licence.** spektrafilm's code is GPL-3.0, like HDR Finisher. Porting or
  reimplementing its diffusion model is allowed. Credit it in
  `THIRD_PARTY_NOTICES.md`, next to the existing profile credit.
- **GPU limits.** spektrafilm's filter shapes may have long tails. Every GPU blur
  keeps its existing cap, and the tile and viewport reach stays within the limits
  Phase 2 set. If a filter needs more reach than the caps allow, approximate it
  within the caps, say how much of the shape is lost, and do not raise a cap
  without asking Steve.
- CPU export and Proof are the exact reference; GPU and CPU agree at the existing
  tolerances. Do not loosen any check.
- Do not change grain, resolution, halation, the stage order, the stock data or
  the Phase 3 controls.
- No migration code. Presets lose the removed fields (rebuilt in Phase 5).
- Keep each file's existing line endings.
- Commit locally in small commits. Do not push. Do not build the installer.

## Testing

As `AGENTS.md` sets out: the fast checks for every change, plus the GPU checks
that cover the lens stage (the Film Look spatial/bloom parity checks and the
Direct/Tiled film parity) once for the group: each filter type at low and full
strength, minimum and maximum Size, 35mm and Super 8, SDR and HDR. Validate at
Fit and at 100%. Stop and ask Steve first if validation looks like more than
about 30 minutes.

## Questions protocol

When something is unclear, or the code disagrees with this brief or the plan,
make the smallest reasonable choice that is easy to undo, note it, and carry on.
Stop only if carrying on could damage export, a pinned check or Steve's data.

## When you finish

End with three parts, in this order.

**1. Report for Steve.** Short, plain language: what he can try in the app, what
was removed, any speed cost, what was run and what failed (one line each), and
the commits.

**2. Questions and doubts.** Every decision this brief did not cover, each with
what you chose and the alternative; how much of each filter's shape the GPU caps
cut off; and the recommendation on finer controls.

**3. Handoff prompt for the next thread**, which does **Phase 4 (stock
character)**: per-stock grain, halation and paper defaults from PRD section 5,
and the "from the stock / set" tracking with the reset dot. It points to the same
documents, says what is left in place and unfinished, lists open questions, and
asks for the same three-part ending.
