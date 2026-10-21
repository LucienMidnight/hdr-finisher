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
5. `ai/docs/product/modules/film-look.md` and
   `ai/docs/product/archive/Film_Look_Rebuild_Plan_2026-10-15.md`, and your Phase 5
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


## Phase 6 implementation record (October 16, 2026)

### Panel implementation commit

Built the approved five-stage panel using the existing instruments and saved
control paths: shared Preset dialog; stock facts and credit; Camera relocation;
Negative tiles and Tone response trims; five Push/Pull segments; locked slide
Print fieldset; Scan and Output note. Disclosures remain page-session-only and
never write adjustment state. Mod text/counts and styling follow deliberate
ownership, including equal-value settings. Reset dots precede names and restore
the stock/common baseline. No renderer, model, calibration, stock data, shader,
budget, tolerance, export or Proof file changed.

Validation for the grouped implementation: 497 Node pass; 2,181 Python pass,
three skips (repository .venv). Focused Electron at requested 2560x1440 passes
stock ownership, all stage recipes and Looks in both lanes, sparse save/reapply,
undo/redo, stock switching and independent Match HDR. Panel checks additionally
pass disclosure keyboard/session behavior without processing changes, summary
and Mod counts after every shortcut/Look, equal-value styling, stock tags,
dot/double-click reset, custom dimensions, slide locks, development arrow keys,
shared dialog apply/save/delete, and control bounds at a measured 300px rail.
Preset tests use memory only; generated media and the disposable Electron
profile protect Steve's folders. No final failure remains. No release sweep,
push or installer.

Initial validation issues: an incorrect --stock-character option started a
render comparison; it was stopped and replaced with --stock-character-only
--presets-ui --panel-ui --ui-only. The old slide test allowed Paper reset on a
slide; it now verifies the approved locked stage, retained paper, and reset on
a negative. Initial screenshot captures were clipped/covered by the rail header;
the capture helper temporarily removes ancestor clipping and sticky header
positioning, photographs the real controls, then restores those styles.
The screenshots are full-height inspection captures, not a claim that the whole
expanded panel fits the normal viewport without scrolling.

Control names for screen readers come from the visible heading and owning
effect (for example Halation Amount), never from all the options in a picker.
Existing stock-relative readouts and slider bounds remain, including the
100% stock wording; the mock-up's numerical ranges are illustrative.

### Decisions and alternatives

- Use full-width ordinary sliders and the real 46x24 switches/segmented tokens,
  as the guidelines require. Alternative: copy the mock-up's paired sliders and
  simplified smaller switches. Tone response remains full-width inside Grain;
  compact child rails were permitted but not needed.
- Keep the real module index 16. Alternative: copy the illustrative mock-up's 07,
  which would disturb the app's established module numbering.
- Summaries truncate visually with full accessible text/title. Alternative:
  wrap long stock/paper names and make stage headers taller.
- Share stage disclosure state across HDR/SDR and recipe changes for the page
  session, like the existing rail. Alternative: per-rendition disclosure state
  or reopening Negative after each Look. Count all deliberately set stage
  controls, including retained hidden dimensions; alternative: count visible
  controls only and conceal deliberate retained settings.
- Derive grain words from calibrated stock Amount: <=21 very fine, <=25 fine,
  <=30 medium, otherwise coarse. These describe the existing calibration, not
  a conversion between manufacturer RMS and PGI. All shipped real-stock grain
  calibration is labelled estimate from its provenance. Alternative: display
  raw numbers/ISO or assign prose separately to every stock.
- Derive halation words from anti-halation tags (strong=low, weak=visible,
  none=strong), with estimate from its halation status; derive still/cinema,
  slide and paper facts from existing character metadata. Use picker paper
  names, falling back to a readable data ID. Neutral says straight response
  and no own grain/halation. Alternative: hard-code stock-by-stock copy or imply
  that calibrated effects are confirmed measurements. No stock metadata changed.
- Lock slide Print dots and shortcuts as well as its inputs, retaining every
  saved value. Alternative: preserve the old reset-dot exception; rejected by
  the approved non-editable Print body. The behavioral test records this change.
- Use Adjustment Presets as the shared dialog title, with Built-in / Saved,
  and keep group/lane identification in its context. Alternative: retain the
  prior per-module title and longer section labels. Rename/import/export stay
  PRESETS-01; no new preset management was added.
- Reuse the existing Push/Pull setting behind five buttons and the existing
  recipe application path behind fixed shortcuts. Alternative: a second set
  of saved controls or a new preset system. Lens Strength/Size dim with None,
  matching the mock-up; retained values and their reset dots remain available.
- Opening the approved mock-up used the project's local Electron/Chromium
  harness because the connected browser inventory had no browser. Alternative:
  inspect only its source; actual browser inspection was required and completed.

### Validation/docs follow-up commit

Adds result-based film-panel-ui-check.js through the existing --panel-ui driver,
updates Phase 4/5 UI helpers for the approved fixed buttons and slide lock,
and records the design pattern/current user guide and PRD/plan placement.
Uses the passing grouped checks above; no production change follows validation.
Screenshots under ai/output/: film-look-phase6-hdr.png (Negative open),
film-look-phase6-slide.png (slide Print open), film-look-phase6-sdr.png.

### Release handoff prompt

Continue on film-look-rebuild. Read ai/AGENTS.md, the Film Look PRD and rebuild
plan, Phase 3/3b/4/5 records, this Phase 6 brief/record and known-limitations.md.
Review the entire rebuild before proposing a merge to main. Do not merge,
push or build an installer without Steve's instruction. Run the release-point
checks AGENTS.md requires: both fast suites, full driver sweep, coverage audits,
endurance and broad timing sweeps, using the repository's current release driver
instructions. Estimate slow-test time first; if it exceeds roughly 30 minutes,
stop before running and tell Steve what is needed and the total estimate.
Run GPU drivers serially through the Electron/native harness at 2560x1440.
Keep CPU export/Proof exact, all shader layouts/pins, parity tolerances, memory
and blur budgets unchanged; never overwrite read-only test projects. Include
stock/paper/slide, density grain and Fit/native/strip coverage, lens families,
Direct/Tiled/CPU preview agreement and exact export/Proof, sparse ownership and
Look replacement/persistence, and the new UI-only panel driver. Do not repeat
slow checks on results already within their agreed tolerance. Report unrelated
known failures in one line without broadening this task into their repair.

Keep these open items explicit, distinguishing release blockers from deferred
work: Steve's Portra 400 grain-anchor approval, Fit/zoom/pan responsiveness with
reduced-grain sampling and lens filters, large-filter/Super 8 glow and capped
tails; no controlled Phase 3 whole-preview timing and no physical HDR-display
certification; PRESETS-01 rename/edit/import/export in the shared dialog;
COLOR-DESAT-01 general highlight/shadow desaturation; optional halo warmth and
deferred independent lens component controls; paper choice (provisional Supra
versus Ultra; no extra paper baked); PRD 5.4 current E100 E-4000 sheet, digitized
Vision3 curves, pushed Portra 800 grain and Verita 200D sheet, plus Kodachrome's
unmeasured grain/estimated placement. Keep calibrated estimates labelled.
Carry the existing extreme uncompressed HDR precision/rounding and isolated
outliers, separate Black & White-only tiled issues, safe Match rejection for
the recorded coloured lens target, and Library grade-control pause HTTP 422
warning from known-limitations.md; establish their current release status
without quietly relaxing checks. Present Steve with a plain-language release
assessment, failures and decisions still needed before merging.
