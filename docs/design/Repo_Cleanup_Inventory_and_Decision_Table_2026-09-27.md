# Repository Cleanup Inventory and Decision Table

**Date:** September 27, 2026  
**Repository:** `ai/`  
**Status:** All recommendations approved by Steve on September 27, 2026; repository cleanup batches
1–4 complete; code audit is next

The original table is retained as the approval record. Its `Pending` cells mean **approved**, not
pending owner approval; the execution log at the end of this document is authoritative for whether
each action has now been completed.

Sizes below are measured allocated file content, rounded for readability. Generated directories
overlap their parent totals, so the rows must not be added together without accounting for that.

## Recommended repository shape

- `codebase/` — application source, tests, and build configuration only.
- `docs/` — the single home for product plans, design work, technical evidence, test strategy, and
  user documentation.
- `packaging/` — operating-system packaging definitions.
- `.github/` — repository-host automation.
- `codebase/output/` — the one ignored location for disposable test and build output while it is
  actively needed. Durable evidence is curated into `docs/`; release artifacts and unique raw
  captures are stored outside the repository.

## Top-level inventory

| Item | What it is | Recommendation | Risk | How to get it back | Decision |
|---|---|---|---|---|---|
| `.github/` | Tracked repository automation. | **Keep.** | Low | Git history. | Pending |
| `.claude/` (403 B) | One machine-local launcher file. Now ignored by the repository. | **Keep locally while used; do not track.** Archive it with the other local tooling state if retired. | Low | Backup archive. | Pending |
| `.kilo/` (about 135 MiB) | Local planning state plus two clean detached worktrees. Its plan is an earlier draft of the tracked file under `plans/`. | **Remove the two worktrees after approval, then archive the remaining local tooling state.** | Low after the checks recorded below | Pre-audit backup; the worktree commits remain in Git. | Pending |
| `.pytest_cache/` (135 KiB) | Rebuildable pytest cache. | **Delete after approval.** | Low | Recreated by pytest. | Pending |
| `codebase/` (about 23.9 GiB total) | Application source, dependencies, tests, generated output, packages, and local virtual environments. Only 441 paths are tracked. | **Keep the source tree; clean its generated subdirectories using the detailed table below.** | Medium because source and generated files share the tree | Git for tracked files; backup or rebuild commands for untracked files. | Pending |
| `docs/` (about 21.9 MiB, 163 tracked paths) | User, product, technical, test, and design documentation plus some historical design bundles. | **Keep as the one documentation home; prune or archive the historical bundles listed below.** | Low | Git history. | Pending |
| `output/` (about 2.11 GiB) | A second ignored output tree, mostly old Electron profiles and highlight investigation material. | **Retire this location.** Curate durable evidence into `docs/`, move unique raw evidence to the pre-audit backup, and use `codebase/output/` for future disposable output. | Medium because some captures may be unique | Pre-audit backup; curated evidence in Git. | Pending |
| `packaging/` (470 KiB, 14 tracked paths) | Windows/macOS/Linux package definitions and metadata. | **Keep.** | Low | Git history. | Pending |
| `plans/` (44 KiB, one tracked file) | A preview/VRAM audit and remediation plan. | **Move to `docs/technical/`**, then remove the empty top-level directory. | Low | Git history preserves the rename. | Pending |
| Root project files | `.gitignore`, `README.md`, release notes, licence, and third-party notices. | **Keep.** The local `design-qa.md` is already ignored and should be archived when no longer active. | Low | Git for tracked files; backup for `design-qa.md`. | Pending |

## Detailed cleanup candidates

| Item | What it is | Recommendation | Risk | How to get it back | Decision |
|---|---|---|---|---|---|
| `.kilo/worktrees/casual-keyboard` | Clean detached worktree at `02dcb1f`; no untracked/ignored files or reparse points. | **Remove with `git worktree remove` after approval.** | Low | Commit `02dcb1f`; pre-audit tag; backup if desired. | Pending |
| `.kilo/worktrees/mulberry-antlion` | Clean detached worktree at `02dcb1f`; no untracked/ignored files or reparse points. | **Remove with `git worktree remove` after approval.** | Low | Commit `02dcb1f`; pre-audit tag; backup if desired. | Pending |
| `codebase/.kilo/worktrees/sturdy-thumb` | Clean detached worktree at `305a14b`; no untracked/ignored files or reparse points. | **Archive or tag the commit if it has historical value, then remove the worktree after approval.** | Low; slightly higher than the other two because it is older | Commit `305a14b`; pre-audit backup. | Pending |
| `codebase/output/` (about 12.68 GiB, 24,882 files) | Test profiles, performance captures, package copies, logs, large NumPy intermediates, native-tool builds, and manual evidence. It also contains two tracked performance JSON files. | **Split, do not remove wholesale.** Move the two tracked JSON summaries and any evidence still cited by documentation into `docs/technical/evidence/`; move unique manual captures to the pre-audit backup; delete only reproducible test/build output after a second, path-level approval. | High because useful evidence is mixed with rebuildable output | Git for the two tracked files; pre-audit backup for unique untracked files; rerun the named tests/builds for generated output. | Pending |
| `codebase/dist-electron/` (about 4.31 GiB) | Multiple historical Windows installers, portable builds, two unpacked app trees, and builder metadata. | **Archive the current 0.8.13 deliverables and checksums outside the repository; delete unpacked trees and older generated packages after approval.** | Medium because exact old binaries may not reproduce byte-for-byte | Pre-audit backup; rebuild with the desktop packaging scripts. | Pending |
| `codebase/dist-electron-film-fix/` (about 552 MiB) | One unpacked manual-test build plus builder metadata. | **Delete after approval** if its corresponding source fix/evidence is already retained. | Low | Rebuild from the relevant commit; pre-audit backup if retained. | Pending |
| `codebase/exports/` (about 251 MiB) | Thirteen locally exported images/files. | **Move to the pre-audit backup**, then use `codebase/output/exports/` for disposable test exports. Do not delete as generic build output. | Medium because exports may be unique | Pre-audit backup. | Pending |
| `codebase/_tmp_avif_test/` (51 KiB) | Temporary AVIF test output. | **Delete after approval.** | Low | Re-run the AVIF test. | Pending |
| `codebase/preview_probe.avif` (43 KiB) | A generated preview probe. | **Delete after approval.** | Low | Re-run the preview probe. | Pending |
| `ai/output/` old Electron profiles (about 1.34 GiB) | Several review profiles; the largest profile accounts for about 1.29 GiB. | **Move to the pre-audit backup or discard after explicit approval if confirmed reproducible.** Future profiles belong under `codebase/output/`. | Medium | Pre-audit backup or rerun the review harness. | Pending |
| `ai/output/highlight-investigation/` (about 804 MiB) | Historical highlight investigation artifacts. | **Curate any cited conclusions/screenshots into `docs/technical/`, move the raw remainder to the pre-audit backup.** | Medium | Pre-audit backup; Git for curated evidence. | Pending |
| `docs/design/HDR finisher UI redesign/uploads/frontend/` (317 KiB) | Five tracked snapshots of `app.js`, `index.html`, `proofing-ui.js`, `styles.css`, and `webgpu-preview.js`. All have live counterparts, and none is byte-identical to current source. | **Remove from the active repository after approval.** Historical source remains in Git and in the associated design bundle. | Low | Git history; design archive. | Pending |
| `docs/design/HDR finisher UI redesign/` and its ZIP (about 3.17 MiB together) | Historical design prototype and a second packaged copy of it. | **Keep one form only.** Prefer archiving the whole historical prototype outside the active repository once its durable decisions are represented by the design guidelines. | Low | Git history; pre-audit backup. | Pending |
| `docs/design/Design review_ layout restructuring.zip` (599 KiB) | Historical design bundle linked by `docs/design/README.md`. | **Keep while it is the linked durable artifact**, or extract/curate its conclusions before archiving it. | Low | Git history. | Pending |
| `docs/design/HDR Finisher UI v2.zip` (1.93 MiB) | Design exploration referenced by the UI refinement PRD. | **Keep until that PRD is complete; then archive.** | Low | Git history. | Pending |
| `docs/design/fonts/` (about 12.0 MiB) | 58 IBM Plex TTF files and licence/readme files used by the historical redesign, not by the shipped frontend. | **Archive with the historical redesign.** Do not remove licences separately from the fonts. | Low | Git history; pre-audit backup. | Pending |
| `codebase/docs/` (7 KiB) | Two September 4 geometry/preview incident notes. | **Move to `docs/technical/incidents/`.** | Low | Git history preserves the rename. | Pending |
| `docs/technical/phase-*` and other evidence notes | Tracked implementation evidence already in the canonical docs tree. | **Keep, grouped under a future `docs/technical/evidence/` directory only if links are updated in the same change.** | Medium because many PRDs link to exact paths | Git history; link checker/test. | Pending |
| `docs/testing/` (46 files, 959 KiB) | Four tracked durable documents and 42 machine-only ignored reports, scripts, and screenshots. | **Keep the four tracked release/strategy documents. Move the 42 ignored files to the pre-audit backup unless selected for deliberate curation into Git.** | Medium because the ignored reports are not recoverable from Git | Pre-audit backup. | Pending |

The inventory found **three** design ZIP files, not the five estimated in the cleanup plan.

## Outer workspace items

These are siblings of the actual `ai/` repository and are not recoverable from its Git history.

| Item | What it is | Recommendation | Risk | How to get it back | Decision |
|---|---|---|---|---|---|
| `../backup/` (about 273 MiB) | April source copies, test TIFF/EXR/HEIC media, Blender files, old scope documents, and native AVIF tools. | **Move intact to `D:\AI\Big Projects Backup\HDR Finisher pre-audit 2026-09-27\outer-backup\`.** Do not delete. | Medium because it contains unique media and old binaries | Pre-audit backup only. | Pending |
| `../output/diagnostics/` (about 163 MiB) | One September 4 incident: useful notes/screenshots/logs plus a 160.6 MiB browser profile. Within the profile, 151.2 MiB is HTTP cache, 8.2 MiB is GPU/WebGPU/cache data, and about 1.1 MiB is Crashpad data. | **Copy `incident.md`, `findings.md`, selected screenshots, and small diagnostic JSON/logs into `docs/technical/incidents/`; move the raw profile, caches, and dumps to the pre-audit backup.** | Medium because the incident evidence is unique | Git for curated evidence; pre-audit backup for raw data. | Pending |
| `../output/electron-test-profile-0.8.6/` | Empty old profile directory. | **Remove after approval.** | Low | Recreate by running the old harness. | Pending |
| `../codebase/` | Empty `tools/` directory. | **Remove after approval.** | Low | Recreate if needed. | Pending |
| `../.git/` (301 B) | Not a repository: it contains only an `info/exclude` file for old Claude runtime state. | **Move to the pre-audit backup, then remove the empty shell.** | Low | Pre-audit backup. | Pending |
| `../agent.md` (832 B) | Stale project instructions: it claims several already-shipped formats are still future work and names obsolete run/test commands. | **Archive outside the active workspace.** The repository documentation and current commands are authoritative. | Low | Pre-audit backup. | Pending |
| `../design-qa.md` (5.5 KiB) | A small local QA note distinct from the ignored 61 KiB `ai/design-qa.md`. | **Move both local QA notes to the pre-audit backup unless actively used.** | Low | Pre-audit backup. | Pending |

## Proposed execution batches after approval

1. **Moves and archives only:** curate incident/evidence documents, consolidate tracked notes under
   `docs/`, and move all unique untracked material to the pre-audit backup.
2. **Tracked repository cleanup:** remove stale tracked frontend snapshots and any approved redundant
   design bundle/font copies; update links in the same change.
3. **Generated deletion only:** remove approved caches, temporary probes, unpacked packages, old
   generated builds, and clean worktrees. Re-check every target for reparse points immediately before
   removal.
4. **Output-tree reduction:** classify `codebase/output/` at path level and delete only entries with a
   known regeneration command. This is deliberately separate because it contains the largest volume
   and the most mixed evidence.

## Execution log

### September 27, 2026 — approved move/archive batch

No files were deleted in this batch.

- Moved the preview/VRAM plan from `plans/` to `docs/technical/`.
- Moved the two tracked September 4 notes from `codebase/docs/` to
  `docs/technical/incidents/`.
- Moved the two tracked Phase 4 JSON records from `codebase/output/performance/` to
  `docs/technical/evidence/preview/` and updated the PRD's durable-evidence path.
- Curated the September 4 incident notes, top-level screenshots, JSON, and logs into
  `docs/technical/incidents/2026-09-04-obs-highlight-black-screen/`. The raw profile and dump remain
  intact in the external archive.
- Moved all 42 ignored `docs/testing/` files (953,134 bytes) to
  `docs-testing-untracked/` in the pre-audit backup. The four tracked test documents remain.
- Moved `codebase/exports/` (13 files; 263,400,881 bytes) to the pre-audit backup.
- Moved the entire duplicate `ai/output/` tree (2,888 files; 2,260,396,851 bytes) to the pre-audit
  backup.
- Moved the outer `backup/` tree (266 files; 286,697,020 bytes) and outer `output/` tree (139 files;
  171,267,120 bytes) to the pre-audit backup.
- Moved the outer broken `.git/` shell, stale `agent.md`, both local `design-qa.md` files, and their
  local-only contents to the pre-audit backup.
- Moved the 0.8.13 Setup, Portable, and blockmap artifacts to
  `release-artifacts/0.8.13/` in the pre-audit backup and added `SHA256SUMS.txt`. All three hashes
  were verified after the move.

Archive root:
`D:\AI\Big Projects Backup\HDR Finisher pre-audit 2026-09-27\`

### September 27, 2026 — approved tracked-design cleanup

- Moved `docs/design/HDR finisher UI redesign/` (14 tracked files, including the five stale frontend
  snapshots) to `tracked-design-archive/` in the pre-audit backup.
- Moved the duplicate `docs/design/HDR finisher UI redesign.zip` to the same archive.
- Moved `docs/design/fonts/` (61 tracked files) to the same archive. The application retains its
  smaller curated runtime font assets under `codebase/frontend/assets/fonts/`.
- Kept `Design review_ layout restructuring.zip` because `docs/design/README.md` still links it.
- Kept `HDR Finisher UI v2.zip` because the UI refinement PRD still cites it.

This batch removed 76 tracked historical/duplicate files totalling 15,911,329 bytes from the active
repository while preserving all of them in the external archive.

### September 27, 2026 — approved generated-output cleanup

- Rechecked all three registered worktrees immediately before removal: each was clean, had no
  untracked or ignored files, and contained no reparse points.
- Removed `casual-keyboard`, `mulberry-antlion`, and `sturdy-thumb` with `git worktree remove`
  without `--force`. Their commits remain available in Git.
- Archived the remaining `.kilo/` and `codebase/.kilo/` planning/tool state under
  `local-tooling-state/` in the pre-audit backup.
- Deleted the rebuildable `.pytest_cache/`, `codebase/_tmp_avif_test/`, and
  `codebase/preview_probe.avif` outputs.
- Deleted the rebuildable `codebase/dist-electron-film-fix/` unpacked build.
- Deleted `codebase/dist-electron/` after the current 0.8.13 deliverables had been archived and
  hash-verified in the earlier batch. The desktop packaging scripts regenerate this output.
- Removed the empty outer `codebase/` shell and the empty `plans/` and `codebase/docs/` directories.
- Deliberately did not touch `codebase/output/`; it remains reserved for the separate path-level
  classification batch.

This batch removed 5,090,757,457 bytes: 4,881,723,650 bytes of generated/cache output and
209,033,807 bytes in the three clean worktrees.

The first post-cleanup Python run reported 1,447 passed and 4 skipped: the former
`codebase/docs/` regression test skipped when the very directory it guarded against no longer
existed. The test now exercises the same adjacent-directory condition in a synthetic temporary
source tree through the pure `_select_docs_root()` path selector. Runtime path behavior is
unchanged, the focused test passes 3/3, and the full baseline is restored to 1,448 passed and
3 skipped. Desktop tests remain 22/22 passing.

### September 27, 2026 — approved `codebase/output` path-level cleanup

The full classification and recovery table is recorded in
`docs/design/Repo_Cleanup_Output_Path_Decisions_2026-09-27.md`.

- Confirmed that `codebase/output/` contained no reparse points and no tracked files still present
  in the working tree. Its two formerly tracked JSON summaries had already moved to
  `docs/technical/evidence/preview/`.
- Deleted 169 exact rebuildable paths: two performance cache trees, 136 generated performance-test
  profiles, and 31 packaged-app, Electron-profile, launcher, native-build, and development-profile
  paths.
- The deleted set contained 9,093,258,452 bytes (8.470 GiB).
- Moved every remaining ambiguous, unique, manual, or cited artifact intact to
  `codebase-output-archive/` in the pre-audit backup: 2,774 files and 4,517,018,027 bytes
  (4.207 GiB). File count and total bytes matched after the move.
- Recreated an empty `codebase/output/` as the project's single location for future disposable
  output.
- Re-ran the baselines with the project virtual environment: Python 1,448 passed, 3 skipped, and 18
  existing warnings; desktop 22/22 passed. The verification run's four disposable diagnostic files
  were removed afterward, so `codebase/output/` is empty again.

No application source or pixel-processing path was changed in this batch.
