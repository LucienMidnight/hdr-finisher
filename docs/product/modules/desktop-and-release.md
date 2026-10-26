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
