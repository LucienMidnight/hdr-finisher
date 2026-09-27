# Repository Cleanup and Code Audit Plan

**Status:** Draft for review; nothing is deleted or changed until Steve approves it
**Date:** September 27, 2026 (revision 3, cut down to the minimum)
**Repository root:** `ai/`

## 1. What this is for

Two things, before the codebase gets any bigger:

1. **Tidy the repository.** Every folder has a clear purpose; old copies, stray build output, and
   leftover scratch are archived or removed.
2. **Clean up AI slop in the code.** Find and fix the problems that build up when many AI sessions
   add to the same code over time, so the code is well built before more features go on top.

Out of scope: new features, accessibility compliance, a full documentation rewrite, formal module
catalogs, and anything that deliberately changes exported pixels.

## 2. Ground rules

- **Nothing is deleted without Steve's yes.** Every removal comes with a plain explanation and a
  way to get it back.
- **No pixel changes.** Cleanup must produce the same images. If a fix would change pixels, it
  becomes a separate proposal.
- **The highlight ceiling is sacred.** The ceiling and no-HDR/SDR-flashing tests must pass after
  every change.
- **The preview must not get slower.** Time from letting go of a slider until the image settles is
  measured before and after.
- **Small batches.** One kind of fix per change, tests run each time, easy to undo.
- **Git history is not rewritten.**
- **Untracked files are moved, never deleted.** `backup/`, `output/`, `.kilo/`, ignored
  `docs/testing/` files, and the outer workspace can't be restored from Git. They rely on
  Backblaze, which keeps deleted files only for a limited time and skips `.exe`, `.dll`, and
  `.log` files. So anything approved for removal is moved to
  `D:\AI\Big Projects Backup\HDR Finisher pre-audit 2026-09-27\` instead of deleted. The files
  Backblaze skips were zipped there on 2026-09-27 (`files-backblaze-skips.zip`).
  Output that can be rebuilt with a known command (for example build output in
  `codebase/output/`, which holds about 1.5 GB of `.exe`, `.dll`, and `.log` files) may be
  deleted outright once Steve approves.
- **Worktree safety.** Before removing any worktree or temporary checkout, check for and unlink any
  junctions or symlinks inside it (a past removal followed a junction and wiped the real `.venv`).

## 3. Before starting

1. Done 2026-09-27: today's code is tagged `pre-audit-2026-09-27` (commit `02dcb1f`), and audit
   work happens on the `audit/repo-cleanup` branch. Merge or park any branch still in progress, so the cleanup doesn't cause merge
   conflicts. 0.8.13 ships after the audit, with its release notes covering the cleanup too.
2. Run the tests and write down what passes and fails today, so a pre-existing failure isn't
   blamed on the cleanup:
   - `python -m pytest -q tests` and `npm --prefix desktop test` from `codebase/`
   - `npm run test:electron`
   - every parity test, including the five that have no npm script (`bw-parity.js`,
     `clarity-map-parity.js`, `grain-parity.js`, `denoise-tiled-parity.js`,
     `tiled-cpu-detail-parity.js`)
3. Record the preview smoothness number (release → settled) on a representative image.

## 4. Quick fixes (already confirmed, low risk)

These can be done straight after step 3:

- Fix `docs/technical/architecture.md:78`, which says there is no project-file format (there is).
- Add npm scripts for the five parity tests that are missing them.
- Remove the throwaway worktrees after checking them: `.kilo/worktrees/casual-keyboard` and
  `mulberry-antlion` (both at current `main`), and `codebase/.kilo/worktrees/sturdy-thumb` (at an
  older commit from Sep 18; check for unsaved work first).
- Make the tooling folders (`.kilo/`, `.claude/`) ignored by the repository's own `.gitignore`,
  not just by settings on this machine.

## 5. Repository tidy

Produce one table covering the top-level folders and anything that looks out of place:

| Item | What it is | Keep / move / archive / delete | Risk | How to get it back |
|---|---|---|---|---|

Known candidates:

- `backup/`: old code copies, test media, Blender files, native tools
- `output/` and `codebase/output/`: two output folders; pick one
- Stray build leftovers: `codebase/exports/`, `_tmp_avif_test/`, `preview_probe.avif`,
  `dist-electron-film-fix/`
- `output/diagnostics/`: keep the useful incident notes, drop browser profiles, caches, and crash
  dumps
- `docs/design/HDR finisher UI redesign/uploads/frontend/`: stale copies of the app source
  (about 1.4 MB)
- Five design ZIP files (about 4.2 MB) and `docs/design/fonts/` (about 8 MB)
- Plans and notes spread over five places (`plans/`, `docs/product/`, `docs/design/`,
  `docs/technical/phase-*`, `codebase/docs/`): pick one home
- Tracked docs that link to files only on this machine (`docs/testing/`)
- The outer workspace's broken `.git/` folder and `agent.md`

Steve approves the table, then the moves happen in one change and the deletions in another.

## 6. AI-slop code audit

### 6.1 What counts as slop

- **Duplicates:** the same function, constant, or default written in more than one place,
  especially between the CPU path, the GPU path, the preview, and export.
- **Dead code:** functions, CSS rules, tokens, settings, and API routes nothing uses any more.
- **Leftovers:** debug logging, temporary flags, "just in case" fallback paths, commented-out code.
- **Swallowed errors:** broad `try/except` or `catch` blocks that hide failures instead of
  reporting them.
- **Stale comments:** comments that mention sprint phases or work items, describe old behavior, or
  just repeat what the code says.
- **Patch-on-patch:** a fix layered over an earlier fix instead of fixing the cause; special cases
  that pile up in one function.
- **Bypassed structure:** new code that works around an existing coordinator
  (`render-coordinator.js`, `preview-scheduler.js`, `viewport-request.js`, `tile-scheduler.js`)
  instead of going through it.
- **Grab-bag files:** very large files that do many unrelated jobs (`app.js` 870 KB,
  `webgpu-preview.js` 532 KB, `styles.css` 230 KB, `adjustments.py` 130 KB, `main.py` 83 KB).
  Size alone is fine; mixing unrelated jobs is the problem.
- **Brittle tests:** `tests/test_frontend_contract.py` checks for about 1,750 exact text snippets
  inside `app.js`, `index.html`, and `styles.css`. Any reorganisation breaks hundreds of these even
  when behavior is unchanged. They need to test behavior before the big frontend files are split.

### 6.2 Order

1. Backend image path: `adjustments.py`, `render_cache.py`, `exporters.py`, `raw_import.py`,
   `main.py`, `models.py`
2. GPU preview: `webgpu-preview.js` and its CPU counterparts
3. Frontend app: `app.js`, `application-shell.js`, `index.html`
4. Styles: duplicate, unused, and undefined CSS variables in `styles.css`
5. Tests: the brittle text-matching tests, and tests that duplicate each other

### 6.3 How findings are reported

One table per area. Each row is written so Steve can decide without reading code:

| # | What's wrong (plain) | Where | What it means for you | Proposed fix | Risk | Decision |
|---|---|---|---|---|---|---|

Risk is **Low** (tidy only), **Medium** (changes structure; tests cover it), or **High** (touches
the image path or saved projects; needs extra checking). Anything already tracked in the PRD's open
items gets a link instead of a new row.

## 7. Fixing

After Steve approves a table, fixes go in small batches in this order: dead code and stale
comments → duplicates → swallowed errors → brittle tests → splitting large files. Each batch:

- runs all the tests from §3 and matches the baseline;
- keeps the highlight-ceiling, no-flashing, and smoothness checks green;
- comes with a two-or-three-line plain summary of what changed and whether you'd notice anything.

## 8. Done when

- every top-level folder has a clear purpose, and the approved moves and deletions are done;
- the slop tables are fixed or consciously parked with a reason;
- all tests pass as well as or better than the baseline;
- images, the highlight ceiling, and preview smoothness are unchanged; and
- a short "where things live" note in `docs/README.md` points to each main area of the code.
