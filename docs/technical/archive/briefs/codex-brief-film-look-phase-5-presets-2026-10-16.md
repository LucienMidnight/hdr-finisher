# Codex Brief: Film Look Rebuild, Phase 5 (Presets)
## HDR Finisher

**Date:** October 16, 2026
**Branch:** continue on `film-look-rebuild` (after `08d0411`).

## Read first, in this order

1. `ai/AGENTS.md`
2. This brief
3. `ai/docs/product/modules/film-look.md`, section 3.3 (presets, R9 to R11)
4. `ai/docs/product/archive/Film_Look_Rebuild_Plan_2026-10-15.md`, section 7 and your
   notes from Phases 1 to 4

Steve owns the project and is not a coder. Write anything addressed to him in
plain language.

## Goal

Presets work in the three layers the PRD describes. Layer 1 (stock character)
is done. This phase adds layer 2, **stage presets** that change one stage only,
and layer 3, **Looks**, complete recipes that store only their stock, paper and
the controls they deliberately set. The four old Looks are rebuilt on real
stocks, and new Looks show off the new stocks.

The final look of the preset menus and the Looks browser is Phase 6 (Claude
makes a mock-up first). Put them into today's panel simply.

## Outcome spec

### Stage presets

- Each stage has a small preset menu. Choosing an entry changes only that
  stage's controls, and those controls become "set" (they show the dot).
- A stage preset never changes the stock, the paper (except in the Print menu)
  or another stage.
- The lists below are Claude's proposal for Steve. Use them as given unless one
  is impossible with the current controls; then propose a replacement.

| Stage | Proposed entries |
|---|---|
| Lens | None · Light diffusion (Black Pro-Mist 1/8) · Soft glow (Pro-Mist 1/4) · Sparkle (Glimmerglass 1/4) · Heavy bloom (CineBloom 1/2) |
| Format | 65mm · 35mm · Super 16 · Super 8. These set Film Format only, so the stock's grain scales with it |
| Development | Pull 1 · Normal · Push 1 · Push 2 |
| Print | Neutral print · Warm print · Cool print · Soft print (lower contrast) · Rich print (higher contrast) · Cinema print (Kodak 2383) |
| Scan | Clean scan (no sharpening) · Lab scan (Lab Levels on, light sharpening) |

Choose the values behind each entry so it is clearly different from its
neighbours but still natural, and record them.

### Looks

- A Look stores its stock, its paper, Film Format if it needs one, and only the
  controls it deliberately sets (PRD R11). Everything else stays "from the stock".
  Switching stock inside a Look then behaves as the PRD says.
- Applying a Look replaces the module's previous Look and stage-preset choices.
  It does not touch controls outside Film Look.
- Users can save their own Looks the same way: stock, paper and the controls they
  set. The existing saved grading presets follow the same rule for their Film
  Look part.
- Look Strength can be part of a Look.
- The list below is Claude's proposal. Build these, choose the deliberate
  settings, and record them. Keep each one recognisable and believable rather
  than extreme.

| Look | Built on | Character |
|---|---|---|
| Clean Cinema | Vision3 250D on Kodak 2383, 35mm | Rebuilt old Look: fine, clean cinema print, light diffusion |
| Soft Color Negative | Fujifilm Pro 400H on its own paper | Rebuilt old Look: soft contrast, gentle colour |
| Dense Print | Kodak Ektar 100 on Fujifilm Crystal Archive | Rebuilt old Look: deep colour, firm print |
| High-Speed Texture | Portra 800 pushed one stop, Super 16 | Rebuilt old Look: coarse grain, open glow |
| Portra 400 Natural | Portra 400 on its own paper | The stock alone, nothing set |
| Night Tungsten | Vision3 500T on Kodak 2383 | Cinema night look, soft glow |
| Everyday Gold | Kodak Gold 200 | Warm consumer print |
| Lab Scan | Portra 160, Lab scan | Clean modern scan look |
| Velvia Landscape | Fujifilm Velvia 100 (slide) | Saturated slide |
| Kodachrome | Kodachrome 64 (slide) | Classic slide |
| Super 8 Memories | Vision3 200T, Super 8 | Home-movie texture and bloom |

- Remove the existing "Portra 400 Full" and "Portra 400 Color" built-ins:
  "Portra 400 Natural" and the stock's own character replace them. If "Portra 400
  Color" (colour without tone) is still useful as a Look, keep it and say why.
- The old Looks' old recipes are not kept. No compatibility code.

## Constraints

- No rendering changes: stage order, stock data, grain, halation, lens filter
  and their drawing stay as they are. This phase only sets control values.
- CPU export and Proof stay the exact reference.
- Keep each file's existing line endings.
- Commit locally in small commits. Do not push. Do not build the installer.

## Testing

As `AGENTS.md` sets out. Fast checks for every change. Test by results: a stage
preset changes only its stage and marks those controls as set; a Look stores
only what it sets; switching stock inside a Look keeps the Look's set controls
and updates the rest; saving, reopening, undo and redo; HDR and SDR; "Match HDR
film look". A rendering check is only needed if you find rendering changed;
then say why.

## Questions protocol

When something is unclear, or the code disagrees with this brief or the plan,
make the smallest reasonable choice that is easy to undo, note it, and carry on.
Stop only if carrying on could damage export, a pinned check or Steve's data.

Steve is judging the Portra 400 grain anchor, lens filter speed and the large
filters' glow in the app. If he sends feedback, record it in the plan; act on it
only if he asks.

## When you finish

End with three parts, in this order.

**1. Report for Steve.** Short, plain language: where to find the stage presets
and Looks, what each Look is meant to look like (one line each), what was run and
what failed (one line each), and the commits.

**2. Questions and doubts.** Every decision this brief did not cover, including
the values behind each preset and Look, each with what you chose and the
alternative.

**3. Handoff prompt.** Phase 6 (the panel) starts with a mock-up by Claude, not
Codex. Write the handoff for Claude: what the panel now contains (every control,
menu and the dot, by stage), what still looks unfinished, open questions, and
anything Phase 6 must not break.


## Phase 5 implementation record (October 16, 2026)

### Chosen values and alternatives

These are creative recipe choices, not measured manufacturer specifications.
All approved entries are feasible; none was replaced or skipped. Existing
rendering equations, calibration, stock tables and bounds remain unchanged.

| Stage | Exact deliberate values | Alternative considered |
|---|---|---|
| Lens: None | Filter none, Strength .5, Size 1 | Change Filter only; chosen full lens reset avoids stale hidden values |
| Lens: Light diffusion | Black Pro-Mist, Strength .125, Size 1 | Smaller Size; keep the calibrated family size |
| Lens: Soft glow | Pro-Mist, Strength .25, Size 1 | Stronger grade; approved restrained grade retained |
| Lens: Sparkle | Glimmerglass, Strength .25, Size 1 | Extra sharpening; rejected because Scan is another stage |
| Lens: Heavy bloom | CineBloom, Strength .5, Size 1 | Larger Size; avoid stacking the already broad family with an enlarged size |
| Format | Film Format only: 65mm / 35mm / super16 / super8 | Reset capture geometry too; rejected by the brief's Film Format-only rule |
| Development | Push/Pull only: -1 / 0 / +1 / +2 | Invent exposure compensation; omitted to stay inside Development |
| Print: all six entries | Start with Paper default; Print Exposure, Warmth, Tint, Preflash, Print Contrast, Shadow Contrast, Highlight Contrast all 0 | Change just the named knob; full Print reset makes successive choices predictable |
| Print: Neutral | The common print baseline above | Neutral stock; rejected because Print must not change the stock |
| Print: Warm / Cool | Baseline plus Warmth +15 / -15 | Stronger filters; moderate 3 CC equivalent chosen |
| Print: Soft / Rich | Baseline plus Print Contrast -20 / +20 | Shadow/highlight trims too; one contrast setting keeps the distinction clear |
| Print: Cinema | Baseline plus Paper kodak_2383 | Additional contrast; let the measured paper provide the difference |
| Scan: Clean | Sharpening 0, Lab Levels false | Leave Lab Levels unchanged; chosen complete Scan reset |
| Scan: Lab | Sharpening 25, Lab Levels true | Upstream-equivalent 70; use light sharpening as requested |

Every value named above becomes set, including equal/default values. None
resets another stage. Push/Pull's existing stock-character refresh still updates
inherited Portra 800 grain for measured +1/+2; that is the existing development
control behavior, not an extra grain override. Alternative: pin grain or suppress
that refresh, which would contradict the inherited stock rule / Phase 4.

Every Look stores stock and Paper (default means the stock's own paper).
The table lists ALL additional deliberately set values. Everything else is
inherited; maps are off. Explicit paper choices have a dot; default paper
identity alone has no dot. All Looks use the existing default Strength 100,
with no Strength override; users can deliberately set/save another Strength.

| Look | Stock / paper | Deliberate values beyond paper | Alternative considered |
|---|---|---|---|
| Clean Cinema | Vision3 250D / kodak_2383 | Format 35mm; Black Pro-Mist .125, Size 1 | Override fine grain; use the stock's fine grain instead |
| Soft Color Negative | Fujifilm Pro 400H / default | Print Contrast -15, Color Separation -10 | Lower Stock Tone; paper contrast preserves the stock curve |
| Dense Print | Ektar 100 / fujifilm_crystal_archive_typeii | Print Contrast +15 | Extra Color Separation; Ektar already supplies deep colour |
| High-Speed Texture | Portra 800 / default | Push/Pull +1, Format super16; Pro-Mist .25, Size 1 | Pin coarse grain or use the hidden pushed stock ID; existing development selects its measured profile and inherited grain |
| Portra 400 Natural | Portra 400 / default | None | Preserve Full/Color recipes; the approved Natural recipe and independent Color/Tone controls replace them |
| Night Tungsten | Vision3 500T / kodak_2383 | Pro-Mist .25, Size 1 | Add a warm/cool cast; retain the stock's tungsten character |
| Everyday Gold | Gold 200 / default | Print Warmth +12 | +15 stage warmth; a slightly gentler consumer recipe |
| Lab Scan | Portra 160 / default | Lab Levels true, Scan Sharpening 25 | Sharpening 70; light sharpening is the agreed character |
| Velvia Landscape | Velvia 100 / default (no print) | None | Added saturation; the stock alone supplies the saturated slide |
| Kodachrome | Kodachrome 64 / default (no print) | None | Artificial tint/contrast; retain the stock's own classic slide character |
| Super 8 Memories | Vision3 200T / default (2383) | Format super8; CineBloom .25, Size 1 | Heavy bloom .5; smaller gate already enlarges the glow |

Other implementation decisions and alternatives:

- Extend stock_overrides to all 38 saved creative Film Look controls, including
  enable switches and Look Strength. Keep film_stock as identity and maps as
  preview-only. Alternative: add a second ownership list; one list keeps project,
  undo and Match copying simple. No stock values or render uniforms change.
- Seven genuinely stock-varying values still refresh on stock changes. Other
  inherited controls use their existing common baseline. Alternative: invent
  per-stock lens/scan/exposure defaults; there is no source for those.
- Dots reset all tracked controls; checkboxes, selects and physical dimensions
  get the same dot as sliders. Double-click resets sliders. Alternative: dots
  only for the previous seven fields; that cannot show stage-preset ownership.
- Sparse recipe version is 6. Applying one starts a fresh Film Look baseline,
  sets its deliberate values, then resolves inherited grain/halation/paper.
  Alternative: merge into the previous Look; that retains unwanted stage choices.
  Equal-value edits remain deliberate; comparing numbers to defaults loses intent.
- Keep default paper as the symbolic identity default, including slides; slides
  still bypass Print. Alternative: freeze the current concrete paper, which would
  prevent stock changes from adopting the new stock's matching paper.
- Use one common baseline function for new Film Look state and recipe expansion.
  Alternative: duplicate defaults in the preset code, risking drift.
- Keep today's modal, rename its Film Look header button Looks, and put menus
  immediately above their existing controls. Format remains near Grain until
  the Phase 6 mock-up. Alternative: redesign/reorder the panel now; outside Phase 5.
- Menus return to Choose preset after use; dots and actual controls describe the
  result. Alternative: persist a preset name that becomes misleading after editing.
- Applying/saving a Look never changes the separate module bypass or other groups.
  Alternative: force-enable Film Look; that edits a value outside its recipe.
- Remove both Portra 400 Full and Color. Old full recipes are not retained or
  migrated. Previously saved recipes/projects are not upgraded to sparse intent;
  re-save a current Look to use the new rule. Alternative: infer old intent, which
  is prohibited compatibility work and cannot recover equal-value choices.
- Test sparse persistence through the real save/apply UI with an in-memory preset
  store so Steve's preset folder is never touched; test actual project save/reopen
  and undo with temporary generated media in Python. Desktop preset JSON transport
  is unchanged. Alternative: write test presets into the user's configured folder.
- Replace the old recipe-version source-text assertion with executable sparse
  recipe round-trips; widen the ownership model test for the intended new controls
  and continue rejecting identity as an override. No numerical tolerance changed.
- The first UI comparison compared JSON property order; compare each saved field
  instead, since backend serialization orders fields differently. This changes
  the assertion, not any allowed values or ownership requirement.

### Handoff prompt for Claude: Phase 6 mock-up first

Read AGENTS.md, PRD R9-R11, the rebuild plan and this Phase 5 record. Create the
panel mock-up before implementation. Phase 5 is presets only; keep the approved
lists and sparse/inherited behavior intact. Work from film-look-rebuild.

Today the Film Look header has Looks (existing list-style preset
modal with built-ins, descriptions, Apply, name/save and saved-preset delete),
Reset and module bypass. Look Strength is the first slider. SDR has Match HDR
film look, which copies once, independently. Eleven built-ins are listed above.

Current controls, grouped by their intended physical stage:

- Lens: Lens preset menu, Filter None/Black Pro-Mist/Pro-Mist/Glimmerglass/
  CineBloom; Strength .125-2 and Size .25-4. Format preset menu has 65mm/35mm/
  Super 16/Super 8. The Film Format picker also has Super 35, 16mm and Custom;
  Capture Geometry Frame/Horizontal strip/Vertical strip; Custom Width/Height.
  Format/geometry still physically sit under Grain and need moving in the mock-up.
- Negative: Stock picker (Neutral and the real stocks, excluding hidden pushed
  profiles), spektrafilm credit, Stock Color, Stock Tone, Film Exposure, Color
  Separation; Halation Enabled, Amount, Spread, Hue Offset, Saturation and map;
  Film Resolution; Grain Enabled, Film Type, Amount, Size, Softness, Chroma,
  Shadow/Midtone/Highlight Response trims and map.
- Development: preset menu Pull 1/Normal/Push 1/Push 2; Push/Pull slider (-2..2).
- Print: preset menu Neutral/Warm/Cool/Soft/Rich/Cinema; Paper picker (stock own,
  Kodak 2383, Fujifilm Crystal Archive II); Print Exposure, Preflash, Warmth,
  Tint, Print Contrast, Shadow Contrast, Highlight Contrast. Slides show
  Slides have no print; don't invent a slide print stage.
- Scan: preset menu Clean/Lab; Scan Sharpening; Lab Levels checkbox.
- Output: Match HDR for SDR and existing HDR ratio preservation. There is no
  new editable Film Look HDR highlight control in today's panel; design its
  explanation without inventing new rendering behavior.

All 38 creative controls can have a set dot, including switches, selects and
custom dimensions. Stock identity and the two preview maps do not. A dot click
restores the current stock or shared baseline; slider double-click does likewise.
Grain and halation values store absolute renderer units; the halation readout is
relative to the current stock (100% stock, hue offset 0). Absolute deliberate
values stay fixed when stock changes. Paper default follows the stock; explicit
paper choices survive even through a slide. Portra development updates inherited
grain. Preserve equal-value deliberate edits, sparse save/reapply, replacement
rather than merge, HDR/SDR independence, undo/redo and project persistence.

Unfinished visual work: no Looks strip or six-stage folding layout, menus are
plain selects, Format is still by Grain, checkbox/select/numeric dots need design
polish, and old Film Format tooltip still says grain is last (the renderer now
adds density grain before print). The modal still uses generic preset wording.
Decide how to expose inherited/set state clearly, show custom/edited Looks, and
explain Output. Preserve the approved entries and values unless Steve changes
them; no preset name is persisted as an active-state label.

No rendering, stock calibration, grain/halation/lens equations, stage order,
shader layouts, parity limits, blur/memory budgets or exact export/Proof contracts
may change for this layout work. The existing extreme HDR precision, separate
Black & White tile and Library warning limitations remain outside this work.
Steve's grain-anchor/lens-speed/large-glow judgment remains pending; no feedback
arrived during this phase. Do not treat the recipes as visually approved on all
photographs merely because their state behavior passes.


### Final validation and commit notes

- 0b8be08: stage recipes, eleven sparse Looks, broader deliberate-control tracking,
  dots and sparse user-Look saving. Node 497 pass; Python 2,181 pass / three skip;
  focused Electron state/UI checks pass. Initial syntax/ownership-order mistakes
  fixed; UI property-order comparison corrected without relaxing value checks.
- Validation/docs follow-up: adds film-presets-ui-check.js and the --presets-ui
  option to the existing Electron harness, plus completion notes. Same passing
  runs apply: no production change follows validation. No render checks, broad
  sweep, tolerance changes, push or installer. No final failure remains.
