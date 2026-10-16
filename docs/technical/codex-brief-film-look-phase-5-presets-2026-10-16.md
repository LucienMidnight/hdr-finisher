# Codex Brief: Film Look Rebuild, Phase 5 (Presets)
## HDR Finisher

**Date:** October 16, 2026
**Branch:** continue on `film-look-rebuild` (after `08d0411`).

## Read first, in this order

1. `ai/AGENTS.md`
2. This brief
3. `ai/docs/product/Film_Look_PRD.md`, section 3.3 (presets, R9 to R11)
4. `ai/docs/product/Film_Look_Rebuild_Plan_2026-10-15.md`, section 7 and your
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
