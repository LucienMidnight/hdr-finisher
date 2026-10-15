# Codex Brief: Film Look Rebuild, Phase 1 (Film Data)
## HDR Finisher

**Date:** October 15, 2026
**Branch:** start a new branch `film-look-rebuild` from the tip of `film-stocks-phase-1`.

## Read first, in this order

1. `ai/AGENTS.md`: how much to test, how to report to Steve, commit rules. It
   wins over anything here about testing.
2. `ai/docs/product/Film_Look_PRD.md`: the requirements (R1 to R14) and, in
   section 5, the record of which film data is confirmed, estimated or missing.
3. `ai/docs/product/Film_Look_Rebuild_Plan_2026-10-15.md`: the full rebuild,
   phase by phase. **You are doing Phase 1 only.**
4. `codebase/tools/bake_film_stocks.py` and `codebase/backend/hdr_finisher/film_stock.py`:
   how today's six stocks are baked from spektrafilm and rendered.

Steve owns the project and is not a coder. Write anything addressed to him in
plain language.

## Goal

When Phase 1 is done, HDR Finisher ships film data for every camera stock that
spektrafilm has, plus a small set of alternative papers, in a compact format,
with the per-stock facts that later phases need. The six existing stocks look
the same as before. The new negative stocks can be picked in today's Stock menu
and render correctly in both the GPU preview and CPU export. Slide films render
by scanning the film directly instead of printing it.

No Film Look panel redesign, no control changes, and no change to where
halation, bloom or grain run. Those are Phases 2 to 6.

## Context

- Today: six stocks, each a ~2.3 MB JSON in `backend/hdr_finisher/film_stocks/`,
  baked offline by `tools/bake_film_stocks.py` from a spektrafilm clone
  (github.com/andreavolpato/spektrafilm). Each stock is printed on its own
  default paper (spektrafilm's `target_print`) and the print is scanned.
- The bake switches off everything spatial and random, so the tables are pure
  per-pixel colour and tone.
- The data reaches WebGPU in one storage buffer; `tests/film-stock-parity.js`
  checks GPU against CPU.
- The data is licensed CC BY-SA 4.0 (Andrea Volpato). The credit and changelog
  live in `film_stocks/CHANGELOG.txt`, `SPEKTRAFILM_LICENSE.txt` and
  `THIRD_PARTY_NOTICES.md`.
- Spektrafilm at commit `3bb2c2d` (June 7, 2026) was the version read for the
  plan. If you use a different commit, say which and why.

## Outcome spec

| Area | What should be true when done |
|---|---|
| Stocks | Every spektrafilm camera film is baked: the 6 current ones, plus Vision3 50D, 200T, 250D and 500T, Verita 200D, Ultramax 400, Fujifilm C200, Superia X-tra 400, Portra 800 pushed one and two stops, and the slide films Velvia 100, Provia 100F, Ektachrome 100 and Kodachrome 64. Check spektrafilm's profile list yourself; if it has more or fewer, follow it and say so. |
| Papers | Each negative stock is baked on its own default paper. In addition, every negative stock is baked on **Kodak 2383** (cinema print) and **Fujifilm Crystal Archive Type II**. Do not bake other papers yet; see Questions. |
| Slide films | No print stage. Rendered from the film through a scan, matching spektrafilm's "scan film" path for positive films. Works in CPU export and the GPU preview. |
| Per-stock facts | Stored with each stock: display name, type (negative or slide), still or cine, anti-halation (strong, weak, none), default paper, and the spektrafilm profile it came from. Later phases read these; nothing uses them yet. |
| Format | Compact enough that the paper choice does not grow the app by tens of MB. Your choice of format. Report total size before and after. The packaging specs must still ship the data. |
| Existing stocks | Unchanged on screen. Re-baked tables match today's within the existing film-stock parity tolerance; if any differs more, stop and report it before going on. |
| Stock menu | New negative and slide stocks appear in today's menu and work. The paper is not selectable yet (Phase 3): each stock uses its default paper. The 2383 and Crystal Archive tables are baked and loadable but not exposed. |
| Credit | Changelog and notices updated to list the new stocks and papers and say how the data was modified. |
| PRD | Update section 5.1 of `Film_Look_PRD.md` if anything about the data's source or status changes. |

## Constraints

- **CPU export and Proof are the exact reference** (`AGENTS.md`, "Still strict").
  The film stock stage is part of export, so treat this phase with full care.
- Do not change what any Film Look control does, the order of the Film Look
  stages, or the GPU parameter layout beyond what the new data needs.
- Do not touch grain, halation, bloom, resolution or the Film Response sliders.
  They are removed or moved in later phases.
- No migration code for old projects. Steve has said old projects do not matter
  for this rebuild.
- Do not invent per-stock values. Anything not from spektrafilm or a data sheet
  is marked as an estimate in the PRD.
- Keep each file's existing line endings (`AGENTS.md`).
- Commit locally in small commits. Do not push. Do not build the installer.

## Testing

As `AGENTS.md` sets out: the fast checks (`node --test tests/*.test.js` and
`.venv/Scripts/python.exe -m pytest tests -q`) for every change, plus
`tests/film-stock-parity.js` once for the group of changes, extended to cover
at least one new negative stock, one cinema stock and one slide film. No full
sweep. If validation looks like more than about 30 minutes of slow tests, stop
and ask Steve first.

## Questions protocol

Work through the phase. When you hit something unclear, or the code disagrees
with this brief or the plan, make the smallest reasonable choice that is easy to
undo, note it, and carry on. Do not stop for it unless carrying on could damage
export, a pinned check or Steve's data.

Things already known to be open; recommend, do not decide:

- **Which third paper** to offer (a punchier Kodak option, for example Supra or
  Ultra Endura). Compare them and recommend one, with the size it would add.
- **How many stocks and papers to ship** in total, given the size you measure.

## When you finish

End with three parts, in this order.

**1. Report for Steve.** Short, plain language: what now works, what he can try
in the app, total data size before and after, what was run and what failed (one
line each), and which commits.

**2. Questions and doubts.** Every decision you made that the brief or plan did
not cover, every place you doubted the brief, and anything odd in spektrafilm's
data (for example, a stock that looks wrong). One item each, with what you chose
and what the alternative was.

**3. Handoff prompt for the next thread.** A pasteable prompt for the agent doing
Phase 2 (reordering the chain), which:

- points to the same three documents to read first,
- says what Phase 1 left in place, including the data format and anything not
  finished,
- lists the open questions from part 2 that affect Phase 2,
- asks for the same three-part ending.
