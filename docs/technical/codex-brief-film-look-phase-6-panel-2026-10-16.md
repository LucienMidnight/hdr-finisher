# Codex Brief: Film Look Rebuild, Phase 6 (Panel)
## HDR Finisher

**Date:** October 16, 2026
**Branch:** continue on `film-look-rebuild` (after the Phase 5 commits).

## Read first, in this order

1. `ai/AGENTS.md`
2. This brief
3. **The approved mock-up:** `ai/docs/design/film-look-wireframes/film-look-panel.html`.
   Open it in a browser and use it; its notes column lists what was decided.
4. `ai/docs/design/HDR_Finisher_Design_Guidelines.md`: the authority for tokens,
   type, the `Mod` wording, sliders, switches and disclosure rules
5. `ai/docs/product/Film_Look_PRD.md` and
   `ai/docs/product/Film_Look_Rebuild_Plan_2026-10-15.md`, and your Phase 5
   record and handoff in `codex-brief-film-look-phase-5-presets-2026-10-16.md`

Steve owns the project and is not a coder. Write anything addressed to him in
plain language.

## Goal

The Film Look panel looks and behaves like the approved mock-up, built with the
app's real components. This is the last phase of the rebuild. It changes layout
and wording only; nothing about how the picture is rendered.

The mock-up is a reference for layout, order, wording and behaviour. Its CSS is
simplified: use the app's real components and tokens, not the mock-up's styles.

## Decisions (Steve, October 16, 2026)

- **One preset system.** Film Look's complete recipes (the Looks) open from the
  same **Preset** button and the same **Adjustment Presets** dialog as every other
  module. Rename the header button from "Looks" to "Preset". Built-in recipes are
  listed under "Built-in", the user's under "Saved". Do not build a separate Looks
  browser or strip. Rename, import and export for that shared dialog are recorded
  as `Open_Items.md` PRESETS-01; they are not part of this phase.
- **Sub-sections** (the five stages) fold open with a small twirl-down
  triangle and carry **no numbers**, so they never read as top-level modules
  (which keep their numbers and chevrons).
- **Stage shortcuts** stay fixed buttons inside each stage. They are not managed
  presets and are not added to the dialog.
- **Approved as shown:** Negative is the open stage when Film Look is first
  expanded; the other four start folded. Stock-owned values that are still from
  the stock show a small grey "STOCK" tag.

## Outcome spec

Follow the mock-up for each item below.

| Area | What should be true |
|---|---|
| Header | Number, chevron, FILM LOOK, `Mod` status, Preset, Reset, bypass eye, like the other modules. |
| SDR | "Match HDR film look" at the top of the body, SDR only. |
| Top | Look Strength, then the **Film stock** card: stock picker, short plain-language facts about the stock (still or cinema film; grain in words; halation in words; which paper it prints on, or "scanned directly, no print" for slides; "estimate" where PRD section 5 says so), and the spektrafilm credit. Derive the facts from the stock data and its status labels; do not hard-code them per stock. |
| Stages | In order: **Camera** (Format shortcuts; Film Format, Capture, custom size; Film Exposure; Lens shortcuts; Lens Filter, Strength, Size), **Negative** (Stock Color, Stock Tone, Color Separation; Halation tile; Film Resolution; Grain tile with "Tone response" trims), **Development** (Push/Pull as a five-button segmented control, −2 to +2, with the measured/approximate note), **Print** (Print shortcuts; Paper; Print Exposure; Warmth and Tint; Preflash; Print Contrast; Shadow and Highlight Contrast), **Scan** (Scan shortcuts; Lab Levels; Scan Sharpening). Moving Film Exposure and Film Format into Camera is intended. |
| Stage header | Triangle, name, a short summary of its current settings (as in the mock-up), and `<n> Mod` when the user has set controls in it. |
| Slides | The Print stage summary reads "No print"; its body is dimmed with the short note, and its controls cannot be changed. |
| Output | A short note at the end of the body, not a stage: what happens to HDR highlights (HDR) or to white (SDR). Nothing to set. |
| Set / from the stock | A set control shows the modified dot (the app's existing dot) before its name; clicking it, or double-clicking a slider, restores the stock's or the shared baseline value. Its value uses primary ink and its slider the accent fill. From-the-stock values stay muted, with the STOCK tag on stock-owned controls. Same treatment for sliders, selects, switches and the segmented control. Never rely on colour alone (guidelines). |
| Wording | Fix the outdated Film Format tooltip (grain is no longer last; it is added in the negative, before print). Check every Film Look tooltip against the new order. Use `Mod`, never "custom", "changed" or "edited". |
| Docs | Add the sub-section pattern (triangle, no number, summary, `Mod` count) and the in-stage shortcut buttons to the design guidelines. Update `docs/user-guide/grading-controls-reference.md` for the new panel. |

## Constraints

- **No rendering changes.** Stage order, stock data, calibration, grain,
  halation, lens filter, shader layouts, parity limits, blur and memory budgets,
  and the exact export/Proof contracts stay as they are.
- Keep every Phase 4 and 5 behaviour: sparse saving, equal-value deliberate
  edits, stock inheritance, dot reset, undo/redo, project persistence, HDR/SDR
  independence, Looks replacing rather than merging.
- Stage open/closed state is session-only, like other disclosures. Folding never
  changes processing.
- Keyboard and screen-reader behaviour equal to pointer behaviour; `aria-expanded`
  matches each stage; the panel works at the 300 px minimum Control Panel width.
- No migration code. Keep each file's existing line endings.
- Commit locally in small commits. Do not push. Do not build the installer.

## Testing

As `AGENTS.md` sets out. Fast checks for every change. Electron UI checks by
result: every stage folds and keeps its state in the session; summaries and
`Mod` counts follow edits, shortcuts and Looks; dots and double-click reset;
slide state; SDR Match; the Preset dialog applies, saves and deletes Film Look
recipes like any module's; keyboard navigation; 300 px width. Rendering checks
are not needed unless you find rendering changed; then say why. Retire tests that
pin the old Film Look markup only by wording and replace them with result checks
where practical (`AGENTS.md`, "Changing tests").

## Questions protocol

When something is unclear, or the code or guidelines disagree with the mock-up,
follow the guidelines, make the smallest reasonable choice that is easy to undo,
note it, and carry on. Stop only if carrying on could damage export, a pinned
check or Steve's data.

## When you finish

End with three parts, in this order.

**1. Report for Steve.** Short, plain language: what the panel now looks like,
anything that differs from the mock-up and why, what was run and what failed
(one line each), and the commits. Include two or three screenshots of the panel
(HDR with Negative open, a slide film, SDR) saved under `ai/output/`.

**2. Questions and doubts.** Every decision the brief or mock-up did not cover,
each with what you chose and the alternative.

**3. Handoff prompt** for the release check of the whole Film Look rebuild before
it can merge to `main`: the full checks `AGENTS.md` requires at a release point,
and a list of everything still open from the rebuild (for example Steve's grain
anchor and lens glow judgments, PRESETS-01, COLOR-DESAT-01, halo warmth, data still
missing in PRD section 5.4). Do not run the release check yourself.
