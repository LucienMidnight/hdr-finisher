# Module PRD: Desktop and release

- **Owner:** Steve
- **Master PRD:** [PRD](../PRD.md)
- **Last status check:** October 18, 2026, against the code.
- **Code:** `codebase/desktop/` (`main.js`, `preload.js`, `package.json`),
  `packaging/`, `.github/workflows/`, `codebase/tests/release/`, frontend
  `info-panels.js` and the Settings and Updates panels.

## 1. Purpose

Package HDR Finisher as a normal desktop app on Windows, macOS and Linux:
windows that remember where they were, one shared backend, an update
check, and a release process that is quick to run and safe.

## 2. Scope

- The Electron shell: windows by role (main, Library pop-out), display and
  HDR capability detection, menus, file drops, single instance.
- Packaging: Windows installer, macOS app, Linux (Flatpak and others),
  bundled encoder binaries.
- Updates panel, settings, diagnostics.
- The release process and its checks.

## 3. Decisions

| Decision | Date |
| --- | --- |
| Electron desktop shell with a bundled Python backend (replaced the original browser-plus-PyInstaller plan). | 2026-08 |
| Signing, notarization and clean-machine tests are withdrawn for now. | Steve, 2026-10-08 |
| Release points run the focused release check (`npm run test:release -- --release`, about an hour). The full sweep runs only when Steve asks. See `AGENTS.md`. | Steve, 2026-10-16 |
| Run the trial release build (`desktop-release.yml`) on the branch before tagging. | Steve, 2026-10 |
| A backup push of a work-in-progress branch needs only the fast checks; still ask before pushing. | Steve, 2026-10-11 |

## 4. Current state (October 18, 2026)

**Built:** Windows, macOS and Linux packages; windows tracked by role
with remembered bounds; Library pop-out window; update check; settings;
release workflow and the focused release runner. `v0.9.0` (October 9) and
`v0.9.1` (October 17) are tagged; the app version is 0.9.1.

**Focused-check harness repairs (October 21, 2026).** Initial readiness waits
for Electron to stop loading, with a bounded failure and listener cleanup;
desktop checks select the editor rather than the hidden GPU delivery window.
Pattern-based interaction checks use normal byte import because the Library
owns startup. Native smoke uses disposable photo copies to protect sidecars.
The export-browser check verifies the intended relative result filename and
the chosen output directory separately. B&W recipes use supported halation
controls instead of the retired artistic response fields. No output tolerance
or memory budget changed.

B&W now reaches its numerical checks and still fails on authored SDR: red
filter and alternating extreme sliders exceed the existing added GPU/CPU
difference limits, with and without halation. HDR cases pass. The cause of
that newly exposed discrepancy and its visible effect need separate
investigation; the test remains failing.

**Open**

- **Linux HDR warning** ("Non-authoritative SDR preview") shows on the
  empty launch screen. It should wait until a photo is open
  (`info-panels.js`).
- Linux KDE taskbar icon: the setup is in place (`desktopName`), but no
  hands-on result is recorded.
- The Updates panel has no link to the GitHub Releases page.
- The Flatpak metainfo has no 0.9.1 release entry.
- Whether 0.9.0 and 0.9.1 were published as GitHub releases can't be told
  from the code. Steve to confirm.
- October 19: the window shows Starting… while the backend starts, then
  loads the app when it is ready. Measured visible in 0.424 s from launch
  (limit 1.5 s); remembered bounds and the Library window use the same shell.
- Explicit interfaces between frontend feature files (Modularization
  section 9) were proposed as a next sprint and not done.

## 5. Open work, in order

**V1 scope (Steve, October 26, 2026):** items 1–3 (Linux HDR warning, the
Flatpak release entry, the Releases link) are after v1. Before v1 comes the
repair of the broken release checks (reviewed plan:
`docs/technical/briefs/prerelease-remediation-plan-2026-10-24.md`), then the
installer and a methodical bug hunt.

1. Linux: show the HDR warning only once a photo is open.
2. Add the 0.9.1 Flatpak release entry at the next release.
3. Releases link in the Updates panel.
5. Explicit interfaces between frontend feature files, if Steve wants it.

## 6. Detail and history

- Electron move: [Electron_Desktop_Wrapper_Sprint_PRD](../archive/Electron_Desktop_Wrapper_Sprint_PRD.md)
- Code layout: [Codebase_Modularization_Sprint_PRD](../archive/Codebase_Modularization_Sprint_PRD_2026-10-06.md),
  [code map](../../technical/code-map.md)
- Hardware matrix: [Phase5_Hardware_Matrix](../archive/Phase5_Hardware_Matrix.md)
- Release checks: `codebase/tests/release/README.md`
- Packaging history and Linux qualification:
  [HDR_Finisher_PRD_v1.2 sections 10 and 13](../archive/HDR_Finisher_PRD_v1.2.md)
- Setup guides: [Windows](../../setup/windows.md), [macOS](../../setup/macos.md),
  [Linux](../../setup/linux.md)


**October 28, 2026: certification continuation tooling.** The release runner
can select unfinished driver names from an older run plus an explicit rerun,
starting fresh results at the committed current revision. It preserves the old
evidence and verifies ancestry and protected hashes. Registered exact-message
reproductions stop without a retry; additional errors remain open, including
Film's preset-await failure alongside its known numerical case. Desktop smoke's
101 px header failure also stays open. Retouch Library's test sends the same
full scene bytes as Blob uploads to keep DevTools from embedding the raw body
past its 256 MB message limit; application pixels, workload and limits stay
unchanged.

Validation: `retouch-library-gpu` reached its assertions and printed its own
PASS (364,177,588 uploaded bytes; all three protected hashes unchanged).
Runner behavioral tests: 16 passed. Full fast Node: 654 passed, two failures
(`library-scenes` decoder-fallback fixture; `library-single-ready` missing
`HDRLibraryScreenPreviews`). Python: 2,715 passed, three skipped, three failures
(`test_frontend_local_scope_contract` source-text expectation,
`test_library_rgb` missing source luminance, `test_retouch_integration` mock
missing `defer_store`). These tests/application files were unchanged by this
harness repair; no unrelated repair or extra GPU check was attempted.
Logs: `codebase/output/release-fast-node.log`, `release-fast-python.log` and
`release-checks/2026-10-28T14-55-19-034Z-c0b89745fbf37b820554/` beneath that output.
The tested application code is b8f9d6b; 108fd2b contains test tooling and this
record only. No 2050496 pass is claimed at b8f9d6b. The prepared 55-driver
selection is the earlier 54 unfinished drivers plus retouch-library-gpu;
12 have 15.2 minutes of measured history including retries, 43 lack surviving
history. Allow roughly 75–120 minutes as a scheduling estimate, not a complete
measurement. Continuation approval is pending; no merge or push performed.
Task scratch was cleaned; project output remained 0.7 GB.


### November 4 — Library video-memory query

The read-only `desktop:video-memory` query accepts registered Library windows
through the existing window-level handler. Photo commands remain main-only.
The follow-up real-app popped-out query completed without error.


### November 4 — v1 visual refinement, round 1

Built in the accompanying commit: all three neutral themes, Afacad reading type, IBM Plex Mono filenames, soft plate controls, recessed ON/OFF switches, satin slider thumbs, fine/snap markings, and Settings > Appearance accent presets/custom colour. The new accent preference persists through the same desktop/browser preference paths as the theme; unknown values fall back to burnt orange without migration. Existing application settings keep their persistence. No image processing, export, Proof delivery, project or keyboard contracts changed.

The literal accent-ramp formulas apply to every theme/preset, as Steve confirmed; WCAG compliance across all choices is not a round-1 gate. The existing Settings dialog, Control Panel layout and source rail structure remain. Detailed approximations and retained data colours are recorded in the [v1 visual spec](../../design/v1-visual-refinement/HDR_Finisher_v1_Visual_Refinement.md#round-1-implementation-and-tidy-up).

Validation: 800 Node checks pass. Python: 3,043 passed and three skipped in the full run; eight obsolete visual-source checks were updated for the intended change and all 42 tests in the affected files pass. One unrelated Library cached-scene test fails (`test_remembered_failure_does_not_hide_current_grade_cached_scene`, expected 422, got 200). The default Library check completed without picture errors or a memory-limit violation, but reported a 1.682-second frame pause; focused real-Electron captures cover all requested screens and slider modes in three themes. No processing GPU suite or release sweep was appropriate to this appearance-only change.

### November 4 — Menu hover switching

After a menu is opened, hovering another top-level menu switches the open
popover. Hovering a closed menu bar leaves it closed; click and Escape retain
their behavior. Verified across File, Edit, View, Window and Help in the real
Electron app with `tools/v1-control-panel-review.cjs`.

### November 6: Shared panel header alignment

Library, Grade, Proof and Export use the existing 40px panel-header token for both side and centre bars, including their bottom divider. Export previously kept a separate 54px centre header. Shared appearance rules now fix header geometry and title alignment, and centre icons and text in 30px header buttons. Button materials, type, colours and image processing are unchanged.

Validation: real Electron at 2560x1440 confirms all three top headers on each of the four pages are exactly 40px, with matching label positions and bottom edges; header toolbar buttons are 30px with centred icons. Small captures and DOM measurements: `codebase/output/header-alignment-review/` (`library.png`, `grade.png`, `proof.png`, `export.png`, `alignment.json`). Node: 808 passed. Python: 3,070 passed, three skipped, one existing unrelated failure (`test_remembered_failure_does_not_hide_current_grade_cached_scene`, expected 422, received 200). The standard Library check passed with no picture errors, frame-limit or memory violations. No processing GPU sweep was relevant. Output remains 29.3 GB. Automatic approval review blocked removal of the disposable Electron profile (`%TEMP%/hdr-finisher-header-alignment-review`); other review scratch was removed.

## November 6: unified application toolbar

The main window places menus behind the button after HDRF and window controls
after Autosave. Alt and F10 focus the menus. Recent projects lives in File;
macOS uses Open Recent in the system menu, hiddenInset traffic lights and
releases their inset in full screen. Mac behavior needs checking on a Mac.
The separate Library retains native chrome for Windows snap support. Main
window custom maximize still has no native Windows 11 snap flyout.
Validation is grouped with the final UI polish checks; no installer or push.


November 6 panel polish: panel edges and open-section boundaries use the same
neutral hairline; full-height splitters own shared vertical edges. Final
three-theme/minimum-size visual checks cover the grouped UI changes.

