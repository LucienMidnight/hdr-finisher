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

## November 7: shared release-driver repairs

The eight pattern-import drivers named in the shared-root repair task now
import their byte-import helper explicitly (the omission came from `dc898d85`).
Their four obsolete missing-helper known-failure entries are removed. The
overlay-feedback native driver selects the ready editor by URL, rather than
the first Electron window, which may be hidden GPU delivery (`f61997dc`).

The shared test-photo helper makes persistent per-check copies once under
`output/test-photos/<check>/`, reuses them on later runs, and resets/restores
disposable sidecars. Steve approved this on November 7 because D is exFAT
and cannot hard-link; Windows also refuses file symlinks. Shared source
photos and their saved grades are read-only. The affected RAW and precision
drivers use the helper; no per-run RAW copy or hard-link is required.

## November 10: darker default and readable Settings

Default Dark now has a pure-black main background, near-black panels,
brighter text and clearer control/divider edges. Modern Dark preserves the
former Default Dark palette; Default Light and Studio Gray keep their palettes.
All four choices persist and synchronize with Library windows. Existing
Default Dark preferences select the new darker appearance; no saved projects
are affected.

Settings uses the existing 16px token for main text and controls, 14.5px for
supporting text, and 20px headings. The application menu and its submenus
have a solid raised surface and a visible 2px border; the root menu starts
at the hamburger glyph rather than the product logo. Pending Steve's visual
sign-off in the app. Review captures: `codebase/output/review/theme-settings/`.

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


November 6 icon polish: the three runtime icon SVGs now use a subtle panel-to-
app near-black gradient. The shared 1024 px desktop PNG is regenerated from
the SVG; Windows/macOS/Linux packaging derives platform icons from that PNG,
and Flatpak installs the SVG directly. No tracked ICO/ICNS exists. Glyph
geometry and design-history sources are unchanged. Review includes 16/24/32/
48 px icons; no installer or package build was needed.


The November 6 minimum-window review also found viewer tools clipping in the
existing compact layout. They now wrap within the viewer width. Development
windows explicitly use the regenerated icon, as packaged windows already do.


## November 6: UI polish validation and review

Implemented all nine sections of the archived unified-title-bar brief, with
small follow-up fixes found during review. Runtime image processing, export,
Proof and saved grade structures are unchanged. Main-window Windows 11 snap
flyouts remain unavailable on the custom maximize button. The popped-out
Library deliberately retains native chrome and snap support. macOS hiddenInset
traffic lights, native menu and full-screen spacing are implemented but need
checking on a Mac; native dragging and OS maximize gestures need manual review.

Fast checks: 816 JavaScript passed; Python 3,077 passed, three skipped, with
only the previously documented unrelated remembered-failure Library test
failing. The plain 90-second Library check has no picture errors or memory
breach, but fails the existing 250 ms drawing-gap limit at 843 ms. No repeat,
GPU sweep, release check, push or installer build. Timings are in the
performance table. Final UI interaction checks cover Alt/F10/Escape, File
Recent projects, one visible wheel, range retention/reset and singular Export
copy. Three-theme captures include 2560x1440 and 1100x720; scope high-DPI
capture uses a 2x emulated display. Mac and physical mixed-DPI checks remain.

Review: `codebase/output/review/ui-polish/index.html`, with small before/after
Library/Grade/Export screenshots, graphs/corner crops, wheel and 16/24/32/48 px
icons. Steve's decisions remain: the larger type sizes, hover/focus-only
Developed badges, and wheel appearance. Baseline Library captures are empty;
after captures use the already-existing small generated review photos. This
review folder can be deleted after sign-off. Logs: `codebase/output/ui-polish-{node,python,library}.log`, plus the quick-check report above. No original
photos or read-only projects were overwritten.


Output size starts and ends at 29.4 GB, below 100 GB; the review is about
3.2 MB. Automatic approval review rejected cleanup with "blocked by policy".
Owned disposable leftovers in Windows TEMP: `pytest-of-Steve/pytest-1290`,
`ui-polish-edit.py`, `ui-polish-section.py`, and `hdr-finisher-electron-test-`
profiles with suffixes MfrIOG, qulncj, USTiDO, jccsA0, 9VpeMY, 9wqnwx, 8Z2Gn6,
IBUDLr, UFjdPZ, Lw7Vjs, YnZL8F, ABMs21 and BYxnMa. Intermediate
`codebase/output/review-ui-polish-{before,checks,after,wheel}.log` files and
`review/ui-polish/after-minimum-{import,grade,export}.png` are also disposable.
Keep the review page's linked images/checks, the three fast/Library logs and
quick-library-check/ui-polish report. No large photographic copies were made.

## November 6: UI polish round 2 validation and review

The Developed badge setting (Appearance: On hover / Always), centred bypass
eye strike, one-pixel resize edges with wide invisible grab targets, visible
whole-module wheel Reset and transparent polar-grid wheel are built. Tabs
and saved/rendered photo data are unchanged. Grade and Library PRDs hold
the behavior; the design guidelines and user guide are updated.

816 JavaScript checks and three desktop-preference checks pass. Python:
3,077 pass, three skip; the existing unrelated
`tests/test_library_live.py::test_remembered_failure_does_not_hide_current_grade_cached_scene`
fails (200 instead of expected 422), as in round 1. It was not changed or
re-run. Focused Chrome review passes reset, badge switching/reload, eye
alignment, rail width, invisible grab area, keyboard/pointer resize and
double-click defaults in all three themes at 1x/2x. No GPU/release checks.

Review: `codebase/output/review/ui-polish/round-2/index.html`, 84 small crops
(0.38 MB). Steve's visual sign-off, physical monitor/DPI checks and native
detached-Library trial remain manual. The completed brief is archived at
`docs/technical/archive/briefs/codex-brief-ui-polish-round-2-2026-11-06.md`.

Scratch output is 29.4 GB at both start and finish, below the 100 GB limit.
Review crops are retained for Steve; the run's server and fast-test scratch
logs were removed. Automatic approval review blocked removal of the run's
TEMP folder `C:/Users/Steve/AppData/Local/Temp/pytest-of-Steve/pytest-1291`
with the reason "blocked by policy"; it remains available for manual cleanup.

## November 6: UI polish round 3

In-panel mode, HDR/SDR (including Local), Proof, curve-channel, scope and
wheel-range tabs use joined plates with existing theme tokens. Workflow tabs
keep their underline. Three tab heights distinguish the levels; changed dots
and tab behaviour stay intact. Validation is grouped at the end of round 3.

Workflow numbers are 21 px and page names 16 px, within the existing toolbar
height. Final size awaits Steve's screenshot review.

Panel titles now display title case without caps tracking, including dynamic
Export headings and embedded/detached Library. Field labels are unchanged.

The menu uses three centred strokes in a fixed 30 px target, avoiding the
font glyph's off-centre baseline. Menu handlers and drag regions are unchanged.

Removed obsolete narrow-screen hover/focus padding overrides on Metadata
headers. Normal header padding now applies in every pointer/focus state;
other titles have no matching hover geometry rule.

Validation: 816 JavaScript tests pass. Python: 3,077 pass, three skip,
one known unrelated failure in
`test_remembered_failure_does_not_hide_current_grade_cached_scene`, already
recorded in rounds 1 and 2; not investigated or rerun. No GPU/release checks,
installer or push. No changes to processing or saved formats.

The focused Electron review passes three-theme tab heights/material borders,
21 px workflow numbers, title casing and stable hover geometry, menu open /
Escape and narrow (1440 px) Metadata hover. Review: 22 small crops (about
0.17 MB) in `codebase/output/review/ui-polish/round-3/index.html`, including
all three tab levels, toolbar and Library/Export titles. Steve's final visual
sign-off and physical mixed-DPI/native macOS trial remain manual. Nothing in
the five sections was skipped. Round 2 was already archived and recorded.

Scratch output is 29.4 GB at start and finish, below the 100 GB limit.
Review crops remain for Steve and can be deleted after sign-off.

## November 6: UI polish round 4: title font

Titles and tab names use locally bundled Sofia Sans Semi Condensed; panel
headings use calm weight 500. Afacad remains for group names and other text.
Workflow tab styling, layout and sizes are unchanged. The font and OFL travel
with the frontend asset directory in existing backend packaging; there is no
separate packaging font list. Validation is grouped at the end of round 4.

Round 4, section 5: application and native menu labels use sentence case,
including submenu headings. Proper names and HDR/SDR/GPU/CPU retain their
capitals. Command IDs, native roles and shortcut handling are unchanged.
Manual quotes of Open recent and Save as now match the menus.
Validation is grouped at the end of round 4.

Round 4 validation and outcome: all six sections are built. Three themes
were checked at 1100 x 720 and 2560 x 1440 in Electron. Title/tab faces,
unchanged 16 px workflow numbers, title containment, Resize label fit, centred
empty state, neutral disabled plate, switch knob/row materials, menu casing
and Grid-hidden/Single-visible 100% control pass. Crops were also inspected;
this caught and corrected the batch-button specificity, desktop menu-slot
casing and narrow toolbar height. No page errors were reported.

Final JavaScript suite: 816 pass. Full Python run: 3,075 pass, three skip,
three fail. The intended sentence-case change required updating the older
native-menu wording assertions; the whole affected contract file then passes
all 15 tests. Two unrelated failures remain, without investigation or rerun:
`test_a_queued_job_waits_past_the_render_deadline_and_still_uses_the_gpu`
(Windows shared-memory mapping missing) and the already recorded
`test_remembered_failure_does_not_hide_current_grade_cached_scene`
(expected 422, received 200). No processing, output, Proof, saved-project or
preset-format changes; no GPU pixel/release sweep, installer or push.

Review: `codebase/output/review/ui-polish/round-4/index.html` and its 72 small
PNG crops, for all themes and both sizes. Steve's visual sign-off and physical
macOS/native menu trial remain manual. No section was skipped. The brief is
archived at `docs/technical/archive/briefs/codex-brief-ui-polish-round-4-2026-11-06.md`.
Scratch output remains 29.4 GB (100 GB limit). Automatic approval review
blocked the cleanup command with "blocked by policy". The owned TEMP folder
`C:/Users/Steve/AppData/Local/Temp/pytest-of-Steve/pytest-1292` and
`round4-*.log` scratch logs in `codebase/output/` (plus the initial failed-launch
log `output/round4-review.log`) remain safe for manual deletion. Keep round-4
crops until Steve has reviewed them; they can then be deleted.

## November 6: UI polish round 5: numbered workflow steps

Workflow tabs now show 1 Library, 2 Grade, 3 Proof and 4 Export with 20 px
round raised-plate badges and thin neutral connectors. The current badge uses
the primary-button accent material and on-accent number; its page name uses
text colour. Other names stay muted and brighten on hover. The underline is
removed. Round 4's title font, toolbar height, navigation handlers, ARIA,
menu, window controls and drag regions remain unchanged.

The Electron review passes all four selected pages in all three themes at
2560 and 1100 px, including containment, badge geometry, font, click/keyboard
navigation, ARIA and menu/Escape. The simulated macOS inset layout passes;
a physical native macOS trial and Steve's visual sign-off remain manual.
No implementation item was skipped. No processing, Proof/export output or
saved-format changes; no GPU pixel/release sweep, installer or push.

Review: `codebase/output/review/ui-polish/round-5/index.html`, with 25 small
PNG crops (about 0.21 MB including the check record and review page).
The crops can be deleted after Steve's review. The brief is archived at
`docs/technical/archive/briefs/codex-brief-ui-polish-round-5-2026-11-06.md`.

Validation: 816 JavaScript tests pass; Python has 3,077 pass, three skip and
one previously recorded unrelated failure in
`test_remembered_failure_does_not_hide_current_grade_cached_scene`
(expected 422, received 200). It was not investigated or rerun.
Scratch output is 29.4 GB at start and finish, below the 100 GB limit.
Automatic approval review rejected cleanup with "blocked by policy".
`C:/Users/Steve/AppData/Local/Temp/pytest-of-Steve/pytest-1294`,
`codebase/output/round5-*.log` and `output/round5-review.log` remain safe
for manual deletion. Keep the review crops until Steve's visual sign-off.

## November 6: UI polish round 6

Section 1: vertical application menu with side submenus and Control Panel module-name typography. Alt/F10, arrows and Escape retained; native macOS menu unchanged. Validation grouped after the five sections.

Section 2: enlarged centred menu glyph, muted at rest and text ink on hover/focus/open. Validation grouped at the end of round 6.

Section 3: preview zoom and Library thumbnail-size fills stay neutral at all values. Grading sliders retain their accent behaviour. Validation grouped at the end of round 6.

Section 4: compact spacing and view controls retain one row at the existing 1100 px minimum. Workflow connectors retain an 8 px line at narrow widths. Validation grouped at the end of round 6.

Section 6 (added by Steve): Export batch view/actions centre in the header space after the left-hand title and summary, using compact spacing at minimum width. Validation grouped at the end of round 6.

## November 7: type tokens, minimum size and title placement

Built: every font size, weight, family, line height and letter spacing in the
frontend now uses the type tokens in `visual-tokens.css` (about 30 sizes
became a nine-step scale; old `--sans`, `--mono` and `--display` aliases were
removed). The minimum is 11px; nothing is drawn smaller, including graph
labels. The Library Details panel moved from 12px to 13px and status bars to
12px. The Library folder or album name now sits in the bottom bar and the
toolbar buttons are centred; Export's "Export Batch" title and counts moved
to a new bottom bar the same way. Families are three role tokens so a theme
or a user font choice can replace them later (not built). Steve's visual
sign-off is open. Review: `codebase/output/review/ui-polish/fonts/`.

Later on November 7: the title face is now Bebas Neue, bundled with its OFL
licence, to match the logo (panel titles and in-panel tabs 16px, workflow tabs
24px). The workflow tabs became one joined plate without step numbers or
connectors. The toolbar logo is the square mark from the app icon. The menu
button uses the Tabler menu icon (28px) beside the existing Tabler window
controls (16px). Library sidebar chevrons moved 4px right to line up with the
logo. Sofia Sans Semi Condensed stays in the repository but is no longer used.
Review: `codebase/output/review/ui-polish/titlebar/`.

Also November 7: title sizes follow one hierarchy: page titles 24px, panel and
window titles 18px (was 16), section and module titles 16px (was 14.5).

## November 6: UI polish round 6b toolbar fit

Built: toolbar compaction now follows available centre-panel space through
CSS container queries. Secondary labels switch as groups; narrower viewers
also tighten spacing and shorten the title to Preview. The minimum remains
1100 px and workflow connectors retain their minimum visible line. Library
Grid/Single, Grade, Proof and Export Grid/Single keep every control on one
row. Seven distinct pinned Tabler outline icons replace the draft's reused
symbols; full-label hover/focus tooltips preserve existing authored copy.

Round 6's menu, neutral view sliders, sidebar changes and centred Export
header remain. The smart-album diamond was decorative and is removed;
rule editing remains in the context menu. No image processing, delivery or
saved-format behavior changes. Steve's visual sign-off remains open.

Review: `codebase/output/review/ui-polish/round-6/index.html` includes small
three-theme crops at 1100, 1200, 1201, 1300 and 1500 px, with Library panels
open/closed and the main workspace's supported source/scopes states, plus a
hovered icon tooltip. Compact metadata retains its existing temporary overlay;
the Control Panel remains docked. Review folders can be deleted after sign-off.
Validation: 816 JavaScript checks pass. Python: 3,077 pass, three skip,
one previously recorded unrelated failure in
`test_remembered_failure_does_not_hide_current_grade_cached_scene`
(expected 422, received 200). Not investigated or rerun. Electron's final
matrix passes containment and non-overlap for all tested widths, themes and
panel states, with no page errors. Narrow Library/Grade, light Export and
wide Library crops plus the hovered icon tooltip were visually inspected.
No GPU pixel check covers this stylesheet-only fit change; the brief asks
for fast checks and UI review only. No release check, installer or push.

Scratch output starts and ends at 29.4 GB, below 100 GB. Keep the review page
and its linked crops/check record, plus `codebase/output/round6b-node.log`,
`round6b-python.log` and `round6b-review.log` for the results above.
Automatic approval review rejected deletion with "blocked by policy".
Owned disposable leftovers: `codebase/output/round6b-*.py`,
`codebase/output/round6b-tooltip.log`, Windows TEMP `pytest-of-Steve/pytest-1297`,
and `hdr-finisher-electron-test-` profiles UdyXEU, lbyl9h, gYG3RR, bGgCNl,
LZXqy0, sUc0Fn and YEOB4l. A tooltip-only cleanup trial hit EPERM after the
capture passed; the driver now reports cleanup blocks without changing the
UI check result. These leftovers are safe for manual deletion.
