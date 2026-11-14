# Module PRD: Desktop and release

## November 14: 0.9.3 UI polish and round 2 review

Workflow pages return to flat navigation, guided by the original underline
switcher in `095b83fc`: the active accent eyebrow meets the header divider,
with no raised/pressed plate. Steve approved the flat tabs, then requested
neutral titles even on the active page: full-strength active text, muted
inactive text, accent only on the lower eyebrow. In-panel tabs keep their plates.
Steve subsequently deprecated Default Dark rather than keeping its lifted
palette. Modern Dark becomes the default dark appearance with every original
palette/material value unchanged; Default Light and Studio Gray are unchanged.
Saved `default-dark`, invalid and missing themes resolve to Modern Dark in
desktop preferences, first paint and the Library. The unused runtime palette
and preview image are removed. Historical v1 design tokens are marked deprecated.

The design guideline and component sheet record Steve's November 14 choices.
Library, Grade and Export details are in their module entries. No processing,
export/Proof pixels, budgets or tolerances change. Only the requested theme
fallback changes persisted preference interpretation. Export folding
is session-only. Both-theme review is at 1408×794 on the MacBook Neo through
the shared GPU lock, with the Library photos fully loaded. Baseline captures
serve the original frontend assets from `85bba832` without changing the working
tree; final captures use the edited assets. Review:
`codebase/output/ui-polish-1114/{before,after}/`. Grade and Proof use the same
generated colour pattern in both sets; Library uses six shared curated copies.

Round 2 captures use the shared curated `IMG_0790_finished.jpg` in Grade,
Proof and Export, Modern Dark and Default Light, with loaded scope graphs.
The compact source rail now reserves width rather than covering fixed chrome;
Export leaves space above its status/footer for the scopes dock. The scope
toggle stays visible when folded, narrow headers avoid dropdown overlap, and
chart labels fit the dock. Source chevrons flip directly rather than rotating
through a corner. Review: `codebase/output/ui-polish-1114/round2/`, added to
the existing `index.html` gallery. Tests retain the one-CSS-pixel geometry
allowance and check Fit, 119% with panning, and 2560×1440 containment.
The Default Dark-only 7:1 test is removed with the retired theme; no threshold
is relaxed and no claim is made that the unchanged Modern Dark meets it.

Round 2 validation: fast Node suite 973 passed / one skipped; venv Python
suite 3,381 passed / 144 skipped / one unexpected pass. The focused check
passes both themes, neutral active/inactive tab ink with an accent-only eyebrow,
retired-theme fallback, reachable scope collapse/reopen controls, chart labels,
and fixed Grade chrome at Fit and 119% after panning. Eighteen final screenshots
include Library and open/collapsed panels; the 2560×1440 captures are viewport
emulation on the Mac, not a PC hardware qualification. Early capture attempts
waited on a scope tier or compared against a dock resized by an intervening
collapse; the driver now checks rendered scope availability and compares Fit
against zoom before independently exercising collapse/reopen.
The mandatory Library smoke still pictures only six of 33 photos and also
reports insufficient system memory reserve; neither unrelated failure is
relaxed, investigated or rerun. See the performance table for that observation.
Scratch output finishes at 6.4 GB, below 100 GB. Visual sign-off remains Steve's.

Round 1 validation (`44c4d87d`): fast Node suite 972 passed / one skipped; venv
Python suite 3,381 passed / 144 skipped / one unexpected pass. The focused
both-theme disclosure, unchanged-settings, selection, contrast and joined-edge
checks pass. The wider batch Export UI driver passes those selection, help,
preset and layout checks but stops at its unchanged Control-click selection
assertion on macOS (three selected instead of the expected two); it assumes
the Windows modifier and was not changed or rerun to investigate selection.
The required 90-second Library smoke repeats the documented incomplete
coverage result: six of 33 photos pictured. Neither unrelated failure was
relaxed or repaired. Scratch output finishes at 6.3 GB, below 100 GB.

## November 13: Phase 1 platform panels (P1-D)

The Linux non-authoritative-preview warning now waits for an open photo and
hides again on close. Settings > Updates has a GitHub Releases button,
available independently of update checking; it uses the existing secondary
button styling and the project-only external-link handler. No new design
tokens or rendering changes are involved. The 0.9.1 Flatpak metainfo entry
was verified already present, so no packaging edit was necessary.

On the MacBook, the focused `desktop/tests/platform-panels.js` check passes
through the shared GPU lock at 1408x794: the real Updates button dispatches
the correct external URL, fits its panel with the existing font, and the
Linux-state warning is hidden/open/hidden across a photo's lifetime. This
simulates Linux capability state, not physical Linux HDR qualification. The
first diagnostic launch selected the short-lived splash; the driver now waits
for the visible main window before attaching. Its disposable profile is
removed on success or failure. The driver is in the release inventory.

Validation: full fast Node suite 935 passed, one skipped; all 13 new JXL
process/fallback regressions pass. Full Python suite: 3,176 passed, 176
skipped, one unexpected pass and 26 failures in untouched Retouch tests.
Twenty-four refused native repair publication for insufficient available
memory; two cancellation tests did not reach their awaited event within five
seconds. Other agents were running on this 8 GB Mac. These failures were
recorded without reruns or changes to Retouch tests, admission or budgets.
Scratch output remained below 100 GB (5.9 GB at start, 6.0 GB at finish).

Windows follow-up: exercise the bundled native JXL helper and the Updates
button. A physical Linux empty/open/close warning check remains; macOS/Linux
JXL helper builds are Phase 2, not this change. Decisions for Steve: the new
helper deadline defaults to five seconds (reason in Import and RAW); no
existing output tolerance, memory allowance or GPU budget was changed.

## November 13: page shortcut hints (approved by Steve, built)

The shared bar uses page-specific hints on Library, Export and Proof; Grade
keeps its pointer-based slider/tool hints. Proof uses current Export and Help
bindings. Export selection hints apply inside the photo grid. Progress tracks
use the existing border token across themes; the accent fill is unchanged.


## November 13: compact grant diagnostics

Library jobs emit library_grant_completed on completion, failure or cancellation,
with outcome, monotonic asked/granted/finished times, wait/run milliseconds and
shared grant fields. asked_fields/granted_fields store only earlier values that
differ from the final shared fields. Exceptional grant events remain. The regular
memory census emits library_grant_stalled once per waiting/running phase after
60 seconds (diagnostic only; scheduling unchanged). No existing general grant
stall threshold/report was present.


### November 13: bounded local diagnostics

Electron owns backend.log (backend stdout/stderr and main-process Library
events) and desktop.log (crash/lifecycle records). Both now use one rotating
writer per file, closing append handles before rotation on Windows. Current
paths and Open Logs remain unchanged. backend.log keeps 7 backups and
desktop.log keeps 1, each file capped at 20 MiB (200 MiB total, approved by
Steve November 13, 2026). Surplus old backups are removed on startup. Packaged
builds include the writer through lib/**/*.js. Approved disk allowance is in
memory-and-caches.md; historical diagnostics beyond retention are discarded.

Noise reduction: full app_memory snapshots once per minute, plus pressure-level
changes and trims; memory sampling/reclamation still run at their original rate.
Cheap lock timings are grouped per operation per minute with counts and maxima;
every wait/hold of at least 10 ms still logs individually. helper_hold logs only
actual ownership changes, retaining pause/resume and all scheduler grant records.


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

November 10 follow-up: Default Dark buttons have darker faces and subtle
edges. Neutral text is softened from white, with at least 7:1 contrast on
normal neutral surfaces and hover plates (WCAG AAA text contrast). Menu
border thickness remains 2px. Accent colours retain the existing formulas.

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

- **Linux HDR warning:** P1-D gates the warning on an open photo; it clears
  again when the photo closes (`info-panels.js`). Local validation is recorded
  in the November 13 platform panels entry below.
- Linux KDE taskbar icon: the setup is in place (`desktopName`), but no
  hands-on result is recorded.
- The Updates panel now has a GitHub Releases button using the existing
  secondary-button tokens and project-only external-link handler.
- The Flatpak 0.9.1 release entry is present (dated October 16, 2026) in
  `packaging/flatpak/io.github.LucienMidnight.hdr-finisher.metainfo.xml`;
  the earlier missing-entry task is stale.
- October 19: the window shows Starting… while the backend starts, then
  loads the app when it is ready. Measured visible in 0.424 s from launch
  (limit 1.5 s); remembered bounds and the Library window use the same shell.
- Explicit interfaces between frontend feature files (Modularization
  section 9) were proposed as a next sprint and not done.

## 5. Open work, in order

**V1 scope (Steve, October 26, 2026; status reconciled November 13):**
items 1–3 are now implemented. Before v1 comes the
repair of the broken release checks (reviewed plan:
`docs/technical/briefs/prerelease-remediation-plan-2026-10-24.md`), then the
installer and a methodical bug hunt.

1. Linux warning lifecycle: implemented in P1-D; physical Linux trial remains.
2. Flatpak 0.9.1 entry: verified present; no packaging change needed.
3. Updates Releases link: implemented in P1-D.
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

## November 10: approved component-sheet materials

Built: Default Dark uses the approved deeper surfaces, stronger raised plates
and pressed wells. Modern Dark, Default Light and Studio Gray keep their
surface palettes. Neutral selection reads plate-down in every theme; accent
changes no longer recolour that bed. The approved title/list/limit tokens live
in visual-tokens.css and tokens.json; the component sheet reads them without
proposal overrides or an approval/depth toggle. No image or saved-grade changes.

Validation for the grouped component pass is recorded below.


Component-pass UI diagnostic is registered in the release inventory. Its
four-theme run passes and the review includes empty and seven-row Local lists.
The older Control Panel diagnostic now expects the intended 34px rows and
204px inner well (previously 32px/192px), without changing its other limits.
Export presets and tag selections also use the neutral pressed shadow.


Validation completed: 904 Node checks pass. Python: 3,280 pass, three skip,
two unrelated failures: GPU delivery queued-job shared memory is missing
(WinError 2), and the known Library cached-scene test returns 200 instead of
422. Neither was repaired or rerun. The focused Electron UI driver passes in
all four themes, including populated/empty lists and graph captures. No
processing GPU sweep or release build was appropriate for appearance-only work.

The standard 90-second mixed Library check stays inside memory (3.432 GB),
but reports a 1,680 ms drawing gap and invalid GPU development pixels for
DSC01226.ARW. These untouched paths were not investigated or rerun. Timings and
conditions are in the performance table. Browser-control services were
unavailable; the component sheet was opened in local Edge through Playwright
and switched through all four themes before app review.

Review: `codebase/output/review/component-pass/index.html` (about 350 KB,
Default Dark and Default Light). Four-theme checks: `checks.json` there.
Logs: `codebase/output/component-pass-{node,python,review,library}.log` and
`codebase/output/quick-library-check/component-pass/report.json`. The review
folder is disposable after Steve's visual sign-off. Output starts/ends at
42.7 GB, below 100 GB. Temporary sheet images/edit scripts were removed.
No push, installer, original photo or read-only project changes.

## November 11: published release history

v0.9.0 was published on GitHub on October 9 and v0.9.1 on October 16,
2026, each with Windows, macOS and Linux packages (confirmed by Steve).
This resolves the former publication question; signing and notarisation remain open.
## November 11: progress IPC release audit

The taskbar-progress event now ignores stale/unregistered senders, malformed
payloads and destroyed main windows. An event listener has no invoke reply
to carry a rejected sender check; previously those inputs could throw in the
Electron main process. Valid main-window progress values, clamping and states
are unchanged. No user workflow or project format changes.

Validation: two behavioural IPC checks execute the actual registration and
event callback with stale senders, null/non-object payloads, other window
roles, destroyed windows and valid progress/state updates; both pass.
The unchanged desktop suite has one existing macOS chrome expectation
failure (titleBarStyle hiddenInset); no platform appearance change was made.

Final W3 fast checks on main 5d338e64 plus the audit: desktop 27 pass / one
unchanged macOS chrome expectation failure; main Node 917 pass; Python
3,241 pass / 55 skip / one known cached-scene failure. The focused real
Electron file-command workflow passes. The standard Library smoke's 3,149 ms
drawing gap is recorded in the Library PRD and performance table, without a
rerun or changed threshold.


## November 12: packaged project-save readiness

Fixed a real Save Project race found while checking the 0.9.2 Windows package:
editing a filename re-enabled Save while the destination lookup was pending.
Clicking then had no destination (or the previous directory), so the dialog
could remain open silently. Save now stays disabled until the folder lookup
succeeds; keyboard confirmation has the same readiness guard. No project
format or image-processing change.

The desktop smoke holds that lookup pending to check the disabled state before
continuing through save and export. It also waits for reference-white edits to
finish before changing the setting again, and uses a disposable preset library
so the portable package's shared presets cannot trigger a replacement prompt.
Failures retain screenshots, renderer/main console output and small logs;
disposable source copies and profiles are removed after shutdown.


Validation of `a5367a61`: rebuilt `pack:dir` succeeds, and the exact Windows
CI command (`npm --prefix desktop run test:packaged`) passes to completion.
The unpackaged smoke through `run-native-electron.js` also passes, both with
the delayed-folder regression. Node: 921 pass; desktop unit checks: 28 pass;
Python: 3,306 pass, three skip (PowerShell reports stderr from the helper's
normal shutdown after the passing summary). No additional GPU pixel driver
covers folder readiness, and none was substituted. No installer, push or tag.

Evidence: `codebase/output/w21-save-race.png`, `w21-save-race.log` and
`w21-save-race-diagnostics.log` capture the original dialog timeout; no
project-save exception is emitted because the early click had no destination.
Final logs: `codebase/output/w21-packaged-final.log`, `w21-unpackaged.log`,
`w21-node.log`, `w21-desktop.log`, `w21-python.log` and `w21-pack.log`.
Output starts/ends at 45.9 GB, below 100 GB. Owned smoke scratch was removed;
the retained failure screenshot and logs are disposable after review.

November 13 installed v0.9.2 investigation (read-only final 200 MB): backend.log
was 3,219,500,801 bytes. Sample spans 14.17 wall-clock hours including a long
inactive gap: 14.1 MB/hour overall, not a representative active-use rate.
Recent complete active clock-hour bins contain 33.1-58.6 MB. Across the
sample: lock_timing 58.48 MB/516,870 records; helper_hold 27.46 MB/93,033;
grant asked/granted/finished combined 74.23 MB/about 43,200 each; app_memory
8.99 MB/2,400. In one complete active hour grants each fired 20,894 times
(5.8/s), helper_hold 39,252 (10.9/s), app_memory 654 (every 5.5 s).
Event-loop lag and Grade-return records were small (0.071/0.013 MB).
This is historical observed usage, not a controlled benchmark or a claim
about post-change growth. Grant records remain intact for admission tracing.


## November 13: two-machine tooling, shared foundations (P1-E)

Test tooling reads one machine JSON outside agent worktrees, discovered through
Git's common directory. Shared helpers select the platform's Python/Electron and
window size; pytest state is isolated before collection. The in-repo Python GPU
lock acquires the existing parent `gpu-run.lock` too, waits for legacy file-lock
holders, and stops POSIX groups plus detached descendants before releasing it.
Stale holders are recovered after 60 minutes only when their owner is dead.
The old `gpu-lock.cjs` is absent from this branch; no second lock is introduced.

Five isolated tooling checks pass (settings agreement, inherited window/exit
status, old-wrapper exclusion, stale dead-owner recovery and detached child
cleanup). Setup and fresh-worktree app validation are the remaining P1-E work.
No application cache location, cache size or rendering behavior changed.


### P1-E setup and driver migration (November 13)

`tools/setup.sh` / `setup.ps1` now prepare a clone or agent worktree with the
Python 3.12 venv, both npm installs, pinned ExifTool, validated native encoders
and shared private-media links. Native build scratch handles paths containing
spaces; subsequent worktrees reuse recipe/architecture-verified binaries.
Drivers use shared Python/process helpers and mapped photo paths; diagnostic
memory sampling has a POSIX counterpart without claiming NVIDIA counters.
Windows' PowerShell sampling and taskkill behavior remain in Windows branches.

Setup completed twice on the Mac; the second run reused the validated native
encoders. Upstream native checks: 14 libavif and one libultrahdr pass. Node fast
checks: 933 pass, one Windows-only skip. Seven focused tooling checks and both
startup-log checks pass. The first full Python run observed a module import
while its helper was being edited; the clean rerun and fresh-worktree
Library/GPU/plan checks are pending below. No workflow, application image maths,
tolerance, budget or shader was changed. The four Desktop release platform
jobs were read; their existing install/build/test commands remain supported.


### P1-E fresh-worktree checks (November 13, continued)

The clean full Python suite passes: 3,182 passed, 176 skipped, one xpassed
(platform/native capability skips are reported by pytest). Setup succeeded in a
fresh detached worktree with spaces in its path, using only the setup command;
its native tools were reused and private media was linked. Release planning
selects 102 drivers conservatively from changes since v0.9.2; fresh worktrees
have no run history, so the runner correctly calls the time estimate incomplete.

Fresh-worktree hash verification exposed an existing callback bug: Array.map
passed its numeric index as the photo-root argument. The runner now maps each
path explicitly; a behavior check covers all three hashes and three mapped
arguments, and still detects a changed project. The explicit memory-sampler
diagnostic now chooses Python on POSIX instead of PowerShell. The lock refreshes
its owner timestamp for interoperability with the old wrapper during long runs,
and stale recovery uses an automatically released OS mutex to serialize breakers.


### P1-E validation outcome (November 13)

Built and committed locally. Final Node suite: 934 pass, one platform skip.
Clean full Python suite: 3,182 pass, 176 skip, one xpass; seven isolated tooling
checks also pass after the lock hardening. Initial Node fixture-dependency
failures and the Python import observed during edits were corrected; clean
checks pass. No app-data/cache/database files appeared in the repository.

From the setup-only worktree at `98a88b2a`, including a path containing spaces:
quick Library ran for 90 seconds through the new lock at 1408x794; the short
neutral-colour GPU driver passed 20 cases / 160 pixels using its migrated venv
Python helper and Electron launcher. All three protected-project hashes stayed
unchanged. Setup and update reused validated native tools, linked the existing
private media, and created no `.venv/Scripts/python.exe` shim. Release planning
worked with the conservative 102-driver selection and explicitly missing
history. No focused release sweep or installer was run for this tooling task.

The Library result remains partial for the existing Mac Step 0 memory-detection
fault: 7/33 pictures shown; both large DJI DNGs refused. Its frame and memory
checks passed. That backend fault belongs to the minimum-hardware workstream;
no app behavior was changed here. The POSIX real-app cache fallback was reported
in known limitations and left unchanged. Setup lists 13 missing literal private
photo/folder dependencies on this Mac, including the badminton folder and
ICC-only JPEG XL sample; no fake inputs or silent skips were added.

Evidence: `codebase/output/p1e-tooling/` holds setup/build, fast-check, Library,
GPU and plan logs plus the small Library/GPU reports. Output stayed 5.9 GB,
below 100 GB. Temporary native build folders and the fresh validation worktree
were removed; shared media and validated native tools remain for future agents.
Windows/Linux execution and packaged smoke tests were not run locally. Existing
Desktop release Windows/macOS/Linux/Flatpak jobs remain unchanged.

**PC handover checks after pulling:**

1. Run the PowerShell setup command in the main checkout and a new worktree;
   rerun it to confirm reuse, the junctions and the missing-media report. Run
   both fast suites with the local venv.
2. Through the in-repo lock at 2560x1440, run the quick Library check and
   `neutral-color-grading-reference.js`. Confirm a second wrapper waits while
   the parent/legacy wrapper holds `gpu-run.lock`, and vice versa.
3. Use a disposable child/grandchild timeout to confirm Windows `taskkill /T`
   stops the full tree before lock release. Verify Python/Electron selection.
4. Run release `--plan` and verify the three protected-project hashes. Keep the
   full focused release check and packaged GitHub builds at release points.

## November 14: minimum-Mac release harness

The 0.9.3 release check uses native macOS physical-footprint samples when
Windows private bytes are unavailable in the overlay backlog guard. Its 2 GiB
growth cap stays unchanged. Denoise corpus preparation now runs inside the
browser cleanup block, so a missing private reference fails promptly instead
of leaving Electron alive until the attempt deadline. Rendering, numerical
guards and the runner's single retry are unchanged. Final qualification is
recorded in `docs/known-limitations.md`.

The fresh 105-driver Mac run also exposed test-only setup gaps. Delivery
instrumentation now waits for the delayed hidden window and its script;
Denoise parity transports identical float bytes instead of large JSON arrays;
Film preset setup uses the actual disclosure button; sidecar saving opens the
compact Metadata rail; theme checks use the platform's menu model (native Mac
menu actions are covered by desktop smoke); and pipeline preparation expects
Mac file-command previews, without executing them. The shared project review
helper reports an unavailable source directly instead of waiting for a native
relink picker. The remaining selection continues through the release runner's
unfinished-work mode. No application code, threshold or protected project changed.
