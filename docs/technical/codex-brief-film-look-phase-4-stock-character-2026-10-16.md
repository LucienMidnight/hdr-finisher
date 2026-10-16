# Codex Brief: Film Look Rebuild, Phase 4 (Stock Character)
## HDR Finisher

**Date:** October 16, 2026
**Branch:** continue on `film-look-rebuild` (after `ac32981`).

## Read first, in this order

1. `ai/AGENTS.md`, including the new sections on what tests should check,
   working within tolerances, and changing tests
2. This brief
3. `ai/docs/product/Film_Look_PRD.md`, especially section 3.3 (presets) and
   section 5 (film data: sources and confidence)
4. `ai/docs/product/Film_Look_Rebuild_Plan_2026-10-15.md`, section 7 (presets in
   three layers) and your notes from Phases 1 to 3b

Steve owns the project and is not a coder. Write anything addressed to him in
plain language.

## Goal

Choosing a stock gives the picture that stock's own character, not just its
colour and tone: its grain, its halation and its paper. Every control the stock
fills in remembers whether it is still "from the stock" or was set by the user,
and changing the stock updates only the ones still from the stock.

This is layer 1 of the three preset layers (PRD R9 to R11). Stage presets and
Looks are Phase 5; the final panel is Phase 6.

## Outcome spec

### What a stock sets

| Control | What the stock sets | Data |
|---|---|---|
| Grain Amount, Grain Size | The stock's own graininess (see "Grain calibration") | PRD 5.3 |
| Halation strength, spread and colour | From spektrafilm's still/cine and anti-halation tags, and its per-colour strengths: the glow's strength, its reach, and its base colour (red nearest the base, so mostly red-orange) | PRD 5.2 |
| Paper | The stock's default paper | PRD 5.1 (already in place) |

- Halation Amount, Spread, Hue Offset and Saturation now work **relative to the
  stock**: at their stock settings the glow is the stock's own, and Hue Offset 0
  keeps the stock's colour (Steve, D2: Hue Offset and Saturation stay). Choose the
  slider meanings (for example, Amount 100% = the stock's own strength) and
  explain them.
- Choosing a real stock therefore turns on its grain and its halation. That is
  intended: it is the stock's character.
- **Neutral** has no grain and no halation of its own.
- Nothing else is stock-owned: Film Format, Push/Pull, exposures, print and scan
  controls, the lens filter and Look Strength stay where the user put them.
  If you think another control should be stock-owned, recommend it; do not add it.

### Grain calibration

The data sheets give a perceived graininess (Kodak Print Grain Index), not our
slider values. Turning one into the other is **our calibration**; nothing in
the data sheets does it for us.

- Anchor the scale on **Portra 400** (PGI 37 at 4x6 from 35mm): pick values that
  look like a real 35mm Portra 400 scan at a stated viewing condition, and say
  what that condition is. Steve will judge the anchor by eye afterwards, so make
  it one number that is easy to change.
- Place the other Kodak still stocks by their PGI relative to the anchor
  (4 points = one just-noticeable step). The 4x6 to 8x10 step (about 21 to 22
  points for twice the enlargement) is confirmed data; use it to check that grain
  grows with Film Format sensibly, and report how well it does.
- PGI mixes grain size and grain strength. Decide how a stock's PGI splits
  between Grain Size and Grain Amount, explain it, and keep it consistent across
  stocks.
- Every other stock is an **estimate**, placed as PRD 5.3 describes: Fujifilm
  negatives next to the Kodak stock of the same speed; slide films relative to
  the finest negatives; pushed Portra 800 coarser than Portra 800; Verita 200D
  and Kodachrome by speed and description.
- **Vision3:** read the per-layer granularity curves off the charts in the data
  sheets, which are kept outside the repo in
  `D:\AI\AI Projects\HDR Finisher Tool\film-datasheets`. Use them to place the
  four Vision3 stocks, and to check our shadow-to-highlight grain shape. If you
  cannot read them reliably, place them by speed as estimates and say so.
- Store each stock's character values with the stock data, each labelled with
  its status and source. Update PRD section 5 so every value shipped traces to
  it as **Confirmed**, **Spektrafilm estimate**, **Proxy**, **Estimate** or
  **Missing**. Do not present an estimate as confirmed.

### From the stock, or set

- Each stock-owned control is either "from the stock" or "set". It becomes "set"
  when the user changes it by hand (later, also by a stage preset).
- Changing the stock updates every control still from the stock, and leaves "set"
  controls alone.
- A "set" control shows a small dot. Clicking it returns the control to the
  stock's value, and it is from the stock again. Put the dot into today's panel
  simply; its final look is Phase 6.
- Saved projects remember which controls are set. Undo and redo cover it.
- HDR and SDR each keep their own state; "Match HDR film look" copies it.

## Constraints

- CPU export and Proof are the exact reference; GPU and CPU agree at the existing
  tolerances.
- Do not change the stage order, the stock tables, the lens filter, or the grain
  and halation rendering itself. This phase sets their values; it does not change
  how they are drawn.
- No migration code. Old projects open (removed fields are dropped) and take the
  new defaults.
- Keep each file's existing line endings.
- Commit locally in small commits. Do not push. Do not build the installer.

## Testing

As `AGENTS.md` sets out. Fast checks for every change. Test the from-stock/set
behaviour by its results: changing the stock with and without set controls,
the dot's reset, save and reopen, undo and redo, and Match HDR film look. Run
`film-stock-parity.js` and `grain-parity.js` once for the group, covering a
still stock, a cine stock, a slide, Neutral, and a stock with set controls.
Propose tolerances before measuring anything new.

## Questions protocol

When something is unclear, or the code disagrees with this brief or the plan,
make the smallest reasonable choice that is easy to undo, note it, and carry on.
Stop only if carrying on could damage export, a pinned check or Steve's data.

Steve is trying the app now: speed with a lens filter on, and how much of the
large filters' glow the GPU limits cut off. If he sends feedback during this
phase, record it in the plan; act on it only if he asks.

## When you finish

End with three parts, in this order.

**1. Report for Steve.** Short, plain language: what changes when he picks a
stock, the Portra 400 anchor and how to adjust it, the dot, what was run and what
failed (one line each), and the commits.

**2. Questions and doubts.** Every decision this brief did not cover (slider
meanings, how PGI splits between Size and Amount, each estimated stock's
placement, how the Vision3 charts were read), each with what you chose and the
alternative.

**3. Handoff prompt for the next thread**, which does **Phase 5 (presets)**: stage
preset menus, Looks that store only their stock, paper and deliberate changes
(PRD R11), rebuilding the four old Looks (Clean Cinema, Soft Color Negative,
Dense Print, High-Speed Texture) on real stocks and papers, and new Looks for the
new stocks. It points to the same documents, says what is left in place and
unfinished, lists open questions, and asks for the same three-part ending.

## Phase 4 implementation decisions (October 16, 2026)

Data/calibration: `f560e7b`. Ownership/panel/model: `d68c215`.
All confidence/source records and shipped numbers are in PRD 5.5; none of the
following calibration choices is a confirmed manufacturer slider value.

| Question / doubt | Chosen | Alternative left open |
|---|---|---|
| Portra 400 visual anchor | Amount 24, Size 30 (13.2 um), 35mm scan displayed 6x4 inches, viewed at 14 inches; Steve still needs to judge it by eye | Start with the older Portra Look's Amount 12, or tune after visual review |
| PGI scale and Size/Amount split | Doubling per 21.5 points; half each log-scale change to physical diameter and Amount | Put the whole change in Amount, or fit a perceptual transfer function |
| Ektar's below-25 bound | Placement 24, Estimate | Lower placement, such as 20; the sheet cannot pick one |
| Fujifilm C200 | Placement 44 beside Gold 200, Estimate | Use finer Portra 160 as the analogue |
| Fujifilm X-tra 400 | Placement 46 beside Ultramax 400, Estimate | Use Portra 400's 37 |
| Fujifilm Pro 400H | Placement 37 beside Portra 400, Estimate | Use Ultramax 400's 46 |
| Portra 800 Push +1 / +2 | Placements 52 / 56, one/two noticeable steps above 48, Estimate | Keep 48 until measured pushed data exists |
| Velvia / Provia / Ektachrome | Placement 24 each, alongside finest negative, Estimate; Ektachrome historical RMS remains Proxy | Place slides finer than Ektar, e.g. 20; do not convert reversal RMS to negative PGI |
| Kodachrome 64 | Placement 24 beside fine slides, Estimate | Finer placement 20 by speed/description |
| Verita 200D | Placement 34 beside 200T, Estimate; manufacturer grain source Missing | Gold 200's placement 44 by speed |
| Vision3 50D / 200T / 250D / 500T | Placements 24 / 34 / 36 / 44, Estimate, using chart ranking; 200T and 250D are close | Speed-only placements, or defer until charts are digitized |
| Vision3 chart readings | Read logarithmic sigma-D at common chart exposure 1.5 / 3 / 4.5, multiply by 1000, approximate +/-25% reading uncertainty | Digitize and align by density/channel or scene exposure; current samples are not cross-stock fixed-density measurements |
| Grain shape / format conclusion | Keep normalized renderer and flat trims; curves' toe hump and declining highlights are only broadly represented. Halved gate doubles pitch within 1e-6; this is not a perceptual PGI certification | Fit per-layer tonal curves / exposure-dependent size in a later grain-renderer phase |
| Halation slider units and set values | 100% stock for Amount/Spread/Saturation, 0 Hue Offset; save absolute renderer values, so set controls stay fixed on stock changes | Save multipliers, which would move the rendered set control with a new stock |
| Halation projection | Map red strength through existing .42 coefficient, sigma to three-sigma radius, fit tint hue to R:G. Weak-back tint also acquires a small blue component in the unchanged model | Add arbitrary RGB tint / a new kernel; outside this phase's renderer constraint |
| Neutral halation controls | Keep existing absolute effect controls, since there is no stock baseline to divide by | Borrow a real stock's baseline for Neutral |
| Enabled switches | Remain independent; picking a stock does not override a deliberate bypass | Make switches stock-owned too, contrary to the brief's seven-control scope |
| Paper identity | Inherited/default means matching paper; set alternatives remain fixed. Explicitly choosing the “Stock's own paper” option keeps that relational choice, not a frozen paper profile | Freeze the concrete default paper; not all such cross-stock tables ship, and baking more is outside scope |
| Portra 800 development | Push +1/+2 refresh inherited grain from pushed entries; leave other stocks' push grain alone | Guess grain changes for every push/pull stop |
| Reset convenience / slider bounds | Dot and double-click both restore inheritance; slides can reset Paper while print is bypassed. Amount/Spread slider spans 200%/400% stock, typed input keeps original absolute bounds; align Hue's slider steps on zero | Dot only; expose entire, much wider relative range on the slider |
| Existing Looks | Leave full recipes for Phase 5; they do not yet encode deliberate overrides sparsely | Rebuild them here, which would exceed Phase 4 |

No change to export/Proof equations, grain/halation drawing, stage order, lens
filter, baked arrays, shader layouts, limits or budgets. No migration code.
Existing projects have no recorded ownership: their controls are treated as
inherited on the next stock change. Existing full Look recipes await Phase 5.
The two untracked Library briefs remain untouched. No Steve lens feedback was
received during this phase.


Final validation/docs commit: 493 Node pass, 2,181 Python pass / three skip;
stock GPU/CPU 10/10 and grain GPU/CPU 12/12 pass at unchanged 0.1 mean / 2 p99.9
limits. Final live UI interaction checks pass. Initial Hue step-grid failure
was fixed; intended schema signature and Neutral bypass expectations were
updated for the requested behavior, without relaxing a tolerance. No final
failure remains. Phase 5 is next; no push or installer. Completion notes and
commit-by-commit records are in the PRD and rebuild plan.
