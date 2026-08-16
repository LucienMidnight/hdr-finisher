# Electron Desktop Wrapper Sprint

**Date:** August 16, 2026

**Status:** Windows MVP 0.3.1 implemented, packaged, and installed-app validated on `feature/electron-desktop-shell`

**Owner:** HDR Finisher engineering

**Related product requirements:** [HDR Finisher PRD v1.2](HDR_Finisher_PRD_v1.2.md)

**Primary launch target:** Windows x64
**Secondary target:** macOS after the Windows shell and package stabilize

## 1. Sprint outcome

Turn HDR Finisher from a local web application opened in the user's browser into a conventional desktop application while retaining the proven HTML/WebGPU frontend and Python image-processing engine.

Electron is a desktop shell, not a rewrite of the editor. The target architecture is:

> Electron owns the application and operating-system boundary. Python owns image state, processing, project serialization, proof generation, and export. The sandboxed renderer owns presentation and interaction.

At the end of the sprint, a user can install and launch HDR Finisher like a normal photo application, open or drop a source file, save and reopen `.hdrfinisher` documents with standard shortcuts, export through native dialogs, reveal outputs in the file manager, and open delivery proofs in an external browser. The packaged application starts and stops its private Python backend without a console window or orphan process.

The existing browser-hosted mode remains available during the sprint for development, regression comparison, and external proof validation. It is not removed until the Electron release passes all exit gates.

## 2. Why Electron is being considered

The controlled Chromium/WebGPU environment is valuable, but it is not the only benefit. Electron can give HDR Finisher the desktop behaviors users expect from Lightroom, Affinity Photo, darktable, and similar applications:

- native open, save, relink, and export dialogs with real filesystem paths;
- standard File/Edit/View/Window/Help menus and platform-correct shortcuts;
- `.hdrfinisher` file association, double-click open, recent projects, and single-instance routing;
- reliable drag-and-drop paths without browser upload copies;
- document dirty state, close/restart confirmation, recovery state, and direct save semantics;
- controlled startup and lifetime of the bundled Python backend;
- file-manager integration for revealing exports and opening files in their default applications;
- taskbar or Dock progress for long proof/export operations;
- display connection, movement, scale, color-space, and refresh-rate events;
- Chromium GPU/driver diagnostics and a recoverable safe-mode path;
- a clean full-screen or second-window preview on a selected HDR display;
- application logs, local crash dumps, and support bundles in predictable OS-owned locations;
- later signed auto-updates without depending on a browser download workflow.

Electron does not replace the need for native HDR telemetry. Electron's display object exposes useful identity, bounds, scale, refresh, depth, and color-space information, but Windows DXGI/display-configuration telemetry remains authoritative for HDR enabled state, luminance, SDR white, and nominal headroom.

## 3. Product principles and boundaries

1. **Preserve the renderer.** Reuse the existing frontend and WebGPU graph. Desktop-specific behavior enters through a small capability adapter rather than scattered Electron checks.
2. **Preserve the Python authority.** Do not port image processing, projects, proofing, or export to Node.js.
3. **Keep the renderer sandboxed.** `nodeIntegration` remains off, `contextIsolation` remains on, and renderer sandboxing remains enabled.
4. **Expose narrow operations, not general power.** The preload bridge may expose `openSource`, `openProject`, `saveProjectAs`, `chooseExportPath`, `revealPath`, and similarly bounded operations. It must not expose raw `ipcRenderer`, arbitrary filesystem access, shell commands, or unrestricted URL opening.
5. **Keep external browser proofing separate.** Electron Chromium is the controlled authoring renderer. The installed browser remains the truth for environment-specific delivery validation.
6. **No silent data loss.** Window close, application quit, backend restart, updater handoff, OS shutdown, and second-instance routing must all respect dirty project state.
7. **Desktop additions must earn their complexity.** Favor features that strengthen the image-finishing workflow; defer tray apps, global hotkeys, cloud accounts, and generic desktop ornament.
8. **Browser mode stays viable until migration is proven.** Existing frontend contract and browser tests continue to pass.

## 4. Recommended branch strategy

Use a separate feature branch because the work adds a second runtime, packaging toolchain, process lifecycle, IPC boundary, and installer behavior.

Recommended branch:

`feature/electron-desktop-shell`

Branch procedure:

1. Finish or checkpoint the current intentional frontend and PRD changes first. Do not create the branch from an ambiguous dirty working tree.
2. Branch from a deterministic green commit that passes the existing Python and browser suites.
3. Keep Electron work in `codebase/desktop/` with its own `package.json`, main process, preload bridge, packaging configuration, and desktop-specific tests. Do not mix Electron runtime dependencies into the existing browser-test package unless the implementation proves that a single package is materially simpler.
4. Keep backend and frontend changes small and capability-based so ordinary browser mode continues to run throughout the branch.
5. Merge only after the packaged Electron artifact passes the release gates. Preserve a tag or branch for the last browser-hosted/PyInstaller technical build until the desktop package is field-tested.

A separate worktree is optional but useful if urgent image-engine fixes must continue on the main branch while the wrapper sprint is active.

## 5. Target architecture

### 5.1 Electron main process

The main process owns:

- single-instance locking and second-launch argument routing;
- `BrowserWindow` creation, restoration, focus, full-screen state, and optional preview windows;
- native menus, accelerators, dialogs, file associations, recent documents, and OS lifecycle events;
- spawning, monitoring, and terminating the bundled Python backend;
- the allowlisted IPC handlers exposed through preload;
- safe external URL and file-manager operations;
- taskbar/Dock progress, notifications, logs, crash dumps, and later update checks;
- application paths, version metadata, and installer-facing identity.

### 5.2 Preload bridge

The preload is the only Electron surface visible to the renderer. Use a typed, versioned capability object such as `window.hdrFinisherDesktop`.

Initial allowlist:

- `environment()` — platform, shell version, app version, packaged state, and supported capabilities;
- `openSource(options)` — native source-file selection;
- `resolveDroppedFiles(files)` — turn OS-backed browser `File` objects into validated local paths through `webUtils.getPathForFile`;
- `openProject()` and `saveProjectAs(suggestedName)`;
- `chooseExportPath(options)`;
- `relinkSource(options)`;
- `revealPath(path)` and `openPath(path)` after backend/path validation;
- `openProofExternally(url)` for an allowlisted loopback proof URL only;
- `setDocumentState({ path, dirty, displayName })`;
- `setOperationProgress({ kind, value, state })`;
- event subscriptions for menu commands, open-file requests, display changes, and application shutdown intent.

Every handler validates type, path intent, extension, sender frame, and allowed URL scheme. Renderer messages never provide executable names or command fragments.

### 5.3 Bundled Python backend

Reuse the existing PyInstaller folder-mode engine as a private sidecar, renamed and configured as a background backend rather than the user-facing application.

Required lifecycle contract:

1. Electron spawns the backend with a per-launch authentication secret and requests an operating-system-assigned loopback port.
2. The backend binds only to `127.0.0.1` and prints one machine-readable ready record containing its port, protocol version, backend version, and health URL.
3. Electron does not reveal the main window until the backend version handshake and health check succeed.
4. The renderer sends the launch secret in an application header on authoring API requests. Origin checks and the secret prevent unrelated local pages from calling filesystem-capable endpoints.
5. The backend receives a parent-process identity or heartbeat and exits if Electron disappears.
6. Electron requests graceful shutdown, waits for active atomic writes, then terminates the process tree only if the timeout expires.
7. Backend stdout/stderr goes to rotating local logs, not a visible console.
8. A backend crash produces a clear recovery screen with Restart Backend, Open Logs, and Quit options. It must not silently discard dirty state.

Use Node's child-process facilities for the Python executable. Electron `utilityProcess` is intended for Node modules and is not the Python sidecar abstraction.

### 5.4 Renderer transport

The lowest-risk first implementation continues loading the frontend from the authenticated loopback FastAPI server because the application already depends on that origin and external proof routes.

Phase 0 must compare this with a packaged secure custom protocol for static UI assets. The loopback design remains acceptable only if it has:

- an ephemeral port selected without a probe/bind race;
- a per-launch authoring secret;
- restrictive CSP and navigation policy;
- no remote content in the privileged renderer;
- explicit permission denial for unused browser capabilities;
- separate, narrowly scoped proof URLs that do not expose authoring APIs.

Do not load the renderer from `file://`.

## 6. Electron opportunity map for HDR Finisher

### 6.1 Launch-critical desktop behavior

| Capability | HDR Finisher benefit | Priority |
|---|---|---|
| Native Open/Save dialogs | Removes path prompts; returns durable source/project/export paths; supports filters, overwrite confirmation, Unicode paths, and platform conventions | V1 desktop gate |
| Standard document shortcuts | `Ctrl/Cmd+O`, `Ctrl/Cmd+S`, `Ctrl/Cmd+Shift+S`, undo/redo, close, full screen, and zoom behave like a photo application | V1 desktop gate |
| Application menus | Commands remain discoverable, disabled when unavailable, and platform-correct; macOS receives a proper application menu | V1 desktop gate |
| File association | Double-clicking `.hdrfinisher` opens or focuses the application and loads the document | V1 desktop gate |
| Single-instance routing | A second launch or associated-file open focuses the existing window and routes the path safely | V1 desktop gate |
| Recent projects | Windows Jump List, macOS recent documents, and File > Open Recent reduce repeated browsing | V1 desktop gate |
| OS drag and drop | Source files and projects can be dropped onto the window while retaining their real paths instead of becoming temporary browser uploads | V1 desktop gate |
| Dirty document semantics | Window title, optional macOS edited indicator, close confirmation, and direct repeat saves make project state understandable | V1 desktop gate |
| Backend lifecycle | No console window, manual browser tab, fixed port assumption, or orphan server | V1 desktop gate |
| Reveal/open output | Export completion can reveal the selected file in Explorer/Finder or open it in its default application | V1 desktop gate |
| External proof launch | Open an exact tokenized proof URL in the user's default browser while the editor stays controlled and isolated | V1 desktop gate |
| Remembered window geometry | Restore size, position, maximized state, and panel layout without placing windows on a disconnected display | V1 desktop gate |

### 6.2 High-value photo-workflow enhancements

| Capability | HDR Finisher opportunity | Constraints |
|---|---|---|
| Dedicated preview window | Put a clean, control-free HDR preview on a chosen second display while controls remain on another screen | Benchmark duplicate-window GPU/memory cost; both windows must show the same accepted generation |
| Display-aware window movement | Detect when the authoring or preview window moves to another monitor and refresh display telemetry/proof labels | Electron display metadata supplements but does not replace DXGI/native HDR telemetry |
| Full-screen presentation | One command presents the current HDR or SDR rendition edge-to-edge on the active preview display | Preserve color pipeline, overlays-off state, cursor hiding, and Escape behavior |
| Display hot-plug handling | React when an HDR monitor is connected, disconnected, rotated, or changes scale/refresh | Retain last valid preview and avoid moving the main window off-screen |
| GPU diagnostic bundle | Record Electron/Chromium version, WebGPU adapter, GPU feature status, driver data, display mapping, backend capabilities, and recent renderer/device-loss events | Make collection explicit and local by default; redact paths where appropriate |
| Safe-mode startup | After repeated GPU-process or renderer crashes, offer a diagnostic CPU-fallback launch rather than leaving the application unusable | Safe mode is for recovery; it must disclose that HDR/WebGPU authoring is degraded |
| Source-file change detection | Detect when the durable original is overwritten by an upstream editor and offer fingerprint-verified reload/relink | Never silently replace the current session or discard adjustments |
| Recovery snapshots | Store bounded, local edit-document recovery data after committed changes and offer recovery after an abnormal exit | Recovery contains edit state, not source pixels; distinguish recovery from explicit project save |
| Taskbar/Dock progress | Show long proof/export progress even when the window is obscured; indicate paused/error state | Clear progress promptly and avoid noisy state changes for ordinary previews |
| Power-management coordination | Prevent application suspension during a long export, then release the blocker immediately; refresh GPU/display state after system resume | Do not keep the display awake for routine editing without explicit justification |
| Export completion notification | Notify only when a long background export completes or fails while the app is unfocused | Respect OS notification settings and avoid notifications for short operations |
| Platform-native contextual menus | Provide copy/reset/reveal/open actions and accessibility-consistent keyboard navigation | Keep authored controls in the web UI where custom interactions are required |

### 6.3 Useful later integrations

| Capability | Possible use | Priority decision |
|---|---|---|
| `hdrfinisher://` deep links | An external proof page can offer **Return to HDR Finisher** or open a specific local proof/session after token validation | Post-V1; never encode arbitrary filesystem operations in a URL |
| Windows Jump List / macOS Dock menu | Open recent project, import image, or reopen last session from the application icon | Post-V1 polish |
| Signed automatic updates | Download and apply signed releases with rollback-aware messaging | After signing is established; macOS automatic updates require signing |
| Update availability check | Notify unsigned-preview users that a GitHub release exists without silently installing it | Suitable before signing if it only opens the official release page |
| Native share menu on macOS | Share a completed SDR-compatible export through installed services | Low priority; verify HDR/gain-map bytes are not transformed by the share target |
| Clipboard integration | Copy metadata, settings, or an explicitly labeled SDR preview | Do not claim an HDR clipboard round trip without format/platform evidence |
| Installer repair and protocol registration | Repair file associations, Start-menu entries, and custom protocol handling | Packaging hardening |

### 6.4 Capabilities deliberately deferred or rejected

- **System tray residency:** HDR Finisher should quit when the user quits; it is not a background service.
- **Global shortcuts:** application-local accelerators are enough and avoid collisions or surprising background behavior.
- **Arbitrary remote pages inside the privileged window:** external proof and documentation open in the system browser.
- **Raw Node.js in the renderer:** prohibited even if it makes early prototypes faster.
- **Replacing all REST calls with IPC:** high migration cost with little product benefit; reserve IPC for desktop/OS operations.
- **Multiple independent editable documents:** defer until session memory, GPU resource ownership, history, and project UX have a separate design.
- **Batch queue/watch-folder workflow:** valuable later, but it changes HDR Finisher's single-image product scope.
- **Custom frameless title bar in the first milestone:** begin with native window chrome. Consider an overlay only after drag regions, accessibility, resizing, and platform behavior are proven.
- **Automatic telemetry uploads:** local diagnostics and user-attached support bundles are the default for this free project.

## 7. Execution phases

### Phase 0 — Architecture spike and baseline

Tasks:

1. Checkpoint the current branch and create `feature/electron-desktop-shell` from a green commit.
2. Record baseline startup time, memory, installer/archive size, WebGPU adapter, representative preview latency, and export time in browser mode.
3. Scaffold `codebase/desktop/` with a pinned stable Electron version and a minimal main/preload/renderer-capability adapter.
4. Compare Electron Forge and electron-builder against the required Windows installer, Python sidecar, GitHub artifact, later signing, and update needs. Record the decision; do not maintain both.
5. Prove that a development Electron window can start the current backend, complete a version handshake, display the existing UI, initialize WebGPU, load the test pattern, and shut down cleanly.
6. Decide loopback-served UI versus packaged secure custom protocol using security, WebGPU, proof, CSP, and test evidence. Default to authenticated loopback unless the custom protocol is clearly safer without destabilizing the app.

Exit gate:

- Existing UI runs unchanged inside a sandboxed Electron window.
- WebGPU and CPU fallback both work.
- Closing Electron leaves no backend process.
- The spike records measured size/memory/startup deltas and a packaging-tool decision.

### Phase 1 — Secure shell and backend lifecycle

Tasks:

1. Implement single-instance locking, second-instance focus, application paths, structured logs, and clean window startup.
2. Add the backend ready/version/authentication contract and eliminate the fixed-port race.
3. Add graceful shutdown, parent-death cleanup, backend crash detection, and a bounded restart flow.
4. Enforce sandbox, context isolation, navigation denial, popup denial, external-URL allowlisting, permission denial, CSP, and IPC sender/argument validation.
5. Expose only the versioned preload capability object.

Exit gate:

- Startup, backend failure, restart, normal quit, forced Electron termination, and second launch all have deterministic outcomes with no orphan backend.
- A normal renderer cannot access Node.js, arbitrary files, commands, unrestricted IPC, or unrestricted external URLs.

### Phase 2 — Native file and project workflows

Tasks:

1. Replace import, project open, Save As, relink, and export-directory prompts with native dialogs in desktop mode.
2. Add direct backend load-by-path so Electron imports do not create unnecessary browser-upload copies.
3. Implement `Ctrl/Cmd+S` direct save, first-save Save As, and `Ctrl/Cmd+Shift+S` Save As after pending edit commands settle.
4. Add `.hdrfinisher` file association, cold-start path handling, warm second-instance routing, and recent-document registration.
5. Support OS drag-and-drop for sources and projects through the preload path resolver.
6. Add reveal-in-file-manager and safe open-with-default-application actions for completed exports.

Exit gate:

- Import, open, save, reopen, Save As, relink, export, drag/drop, double-click open, recent-project open, cancel, overwrite, and Unicode/space-containing paths pass in source-run and packaged builds.
- The first project save records a durable source path and later `Ctrl/Cmd+S` performs no path prompt.

### Phase 3 — Native document and application behavior

Tasks:

1. Implement native File/Edit/View/Window/Help menus with platform roles and accelerators.
2. Synchronize menu enabled state with session, history, dirty, proof, and export state.
3. Show document name and dirty state in the window title; use the native represented-file/edited affordance where supported.
4. Intercept close, quit, restart, updater handoff, and OS shutdown with the safest available dirty-document behavior.
5. Restore window bounds/maximized state safely; clamp restored windows to connected displays.
6. Add bounded recovery snapshots and abnormal-exit recovery UI without conflating recovery with project save.

Exit gate:

- Keyboard, menu, close, crash recovery, and restart behavior matches conventional document applications and cannot silently lose a committed edit document.

### Phase 4 — Desktop workflow leverage

Tasks:

1. Connect long proof/export jobs to taskbar/Dock progress and restrained completion/failure notifications.
2. Prevent app suspension only while an authoritative long operation is active; release all blockers on completion, cancellation, failure, and quit.
3. Add display-change events and refresh the existing native display/HDR telemetry when the active window changes display or the system resumes.
4. Add an explicit external-browser proof action using a short-lived, read-only tokenized URL.
5. Build a local diagnostic bundle with versions, capabilities, GPU feature status, adapter/driver information, displays, sanitized logs, and recent crash/device-loss summaries.
6. Offer a safe-mode startup only after a detected repeated GPU/renderer failure.

Exit gate:

- Desktop progress and power state cannot remain stuck.
- External proof cannot call authoring or filesystem APIs.
- Diagnostics are useful offline and avoid source pixels or unrestricted personal paths by default.

### Phase 5 — Optional second-display preview qualification

This phase is high value but does not block the first Electron wrapper if it threatens schedule or GPU parity.

Tasks:

1. Prototype a clean secondary `BrowserWindow` that receives immutable accepted preview generations and contains no editing controls.
2. Let the user choose a display and toggle windowed/full-screen preview.
3. Reconcile Electron display IDs with existing Windows telemetry without treating either ID namespace as universally stable.
4. Measure GPU memory, frame latency, scope cadence, and device-loss behavior with one and two windows.
5. Handle display removal, scale changes, HDR toggles, system resume, and main-window closure.

Exit gate:

- The two windows never display different accepted edit revisions.
- The secondary window does not materially regress the primary interaction budget or exceed the documented GPU resource gate.
- Moving between SDR/HDR displays updates labels and telemetry without silently claiming colorimetric accuracy.

### Phase 6 — Packaging and release hardening

Tasks:

1. Package Electron, the PyInstaller backend, encoders, licenses, frontend assets, and version metadata into a per-user Windows installer plus an optional portable artifact.
2. Put caches, sessions, logs, recovery, proofs, and temporary work only in user-writable OS application-data paths.
3. Verify install, repair/upgrade, downgrade refusal where necessary, uninstall, association registration, protocol registration if enabled, and preservation/removal of user data according to explicit choices.
4. Generate SHA-256 checksums and retain the exact source revision/build metadata.
5. Follow the unsigned V1 preview and SignPath plan in the main PRD. Do not block the first technical preview on signing.
6. Add a manual update-availability check that opens only the official GitHub release page; defer automatic installation until signing is established.

Exit gate:

- The exact downloaded artifact passes on a clean Windows machine with no Python or Node installation.
- Expected SmartScreen behavior is documented.
- All shipped executables, libraries, licenses, and notices are present and discoverable.

### Phase 7 — macOS adaptation

Tasks:

1. Build native Apple Silicon first, then decide whether Intel or universal packaging is justified.
2. Implement macOS application menu roles, Dock/recent-document behavior, file-open events, paths, and window semantics.
3. Package native encoders and the Python sidecar with correct nested-code signing boundaries and hardened-runtime entitlements.
4. Permit an explicitly labeled unsigned technical preview if needed; complete Developer ID signing, notarization, and ticket stapling before targeting ordinary users.
5. Validate external proofing in Safari and installed Chromium browsers separately from Electron authoring.

Exit gate:

- The `.app`/`.dmg` works on a clean target Mac, and the signed public build passes Gatekeeper and notarization validation when signing is enabled.

## 8. Test and validation plan

### Automated coverage

- Main-process unit tests for argument parsing, path allowlists, URL allowlists, lifecycle state, dirty-close decisions, and progress cleanup.
- Preload contract tests proving the renderer sees only the documented capability surface.
- Electron integration tests for startup, dialogs through injected test adapters, menu commands, second-instance routing, dropped files, backend crash/restart, and quit cleanup.
- Existing Python deterministic suite and frontend browser contract suite remain required.
- Existing Playwright browser flows continue in browser mode; desktop-specific flows add Electron-hosted coverage without replacing browser proof tests.
- Packaged smoke test starts the installed backend, checks `/health` and capability/version parity, loads the generated test pattern, saves/reopens a project, and exports a deterministic artifact.

### Required hands-on matrices

| Matrix | Required cases |
|---|---|
| Paths | Spaces, non-ASCII, long-but-supported paths, removable drive, unavailable path, read-only destination, Windows UNC if claimed |
| Lifecycle | Cold start, warm second launch, close clean, close dirty, backend crash, renderer crash, forced shell termination, restart, OS sleep/resume |
| Files | Open source, open project, drag source, drag project, first save, repeat save, Save As, relink, overwrite, cancellation |
| Displays | Single SDR, single HDR, paired SDR/HDR, move window, hot plug, scale change, HDR toggle, full screen |
| GPU | WebGPU normal, CPU fallback, device loss, hardware acceleration unavailable, safe-mode recovery |
| Packaging | Fresh install, upgrade, uninstall, reinstall, file association, recent document, portable build if shipped |
| Proof | Default browser launch, copied URL, expired token, wrong token, editor closed, two installed browsers |
| HDR delivery | JPEG Ultra HDR and AVIF gain-map controls across local Chromium, Google Drive round trip, iPhone Files/Preview, iPhone Photos import/view/export, iCloud Drive or AirDrop, with exact-byte/hash checks where accessible |

## 9. Release gates

The Electron wrapper is ready to replace the browser-hosted launcher only when:

1. Existing image math, project round trips, proof artifacts, and exports remain byte- or tolerance-equivalent where required.
2. Interactive WebGPU preview and scope performance remains within the existing documented budgets.
3. No user-facing workflow asks for a raw filesystem path when a native dialog is appropriate.
4. Save, Save As, open, relink, recovery, close, and quit cannot silently lose edit state.
5. No backend process survives a normal quit, forced Electron exit, failed startup, or update handoff beyond the defined cleanup timeout.
6. The renderer is sandboxed and cannot reach Node, unrestricted IPC, arbitrary filesystem operations, or arbitrary external URLs.
7. External proof pages have no authoring capability and remain useful in the user's chosen browser.
8. Clean-machine install, upgrade, uninstall, and packaged capability tests pass.
9. The unsigned/signing state and expected OS warning are accurately documented for the exact release artifact.
10. Browser-hosted development mode and its validation instructions remain documented even if it is no longer the default user experience.

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Two bundled runtimes increase size and build time | Medium | Reuse the validated PyInstaller folder backend; measure before optimizing; do not narrow `imagecodecs` without its existing corpus gate |
| Backend becomes orphaned or port startup races | High | Ready-record handshake, OS-assigned port, parent heartbeat, graceful timeout, process-tree cleanup, lifecycle tests |
| Local hostile page calls filesystem-capable API | High | Loopback-only bind, per-launch authoring secret, origin/CSP checks, narrow proof routes, validated preload IPC |
| Renderer XSS reaches Electron privileges | High | Sandbox, context isolation, no Node integration, minimal bridge, sender validation, no remote privileged content |
| Electron Chromium changes HDR/WebGPU behavior | High | Pin stable version, retain browser baseline, GPU/display matrix, quarterly major qualification, CPU fallback |
| Second preview window doubles GPU cost or drifts revisions | High | Immutable generation fan-out, shared state contract, measured resource gate, make Phase 5 optional |
| Native dialog or file association differs by platform | Medium | Platform-specific packaged tests; native menu/file-open handling; retain in-app development fallbacks |
| Unsigned installer alarms users | Medium | Official GitHub-only distribution, checksums, warning documentation, later SignPath application |
| Auto-update distributes a bad or unsigned build | High | Manual update check first; signed automatic updates only after rollback and signature verification are proven |
| Desktop scope consumes image-engine schedule | Medium | Separate branch, phase gates, preserve browser mode, explicitly defer nonessential integrations |

## 11. Open decisions for Phase 0

1. Electron Forge versus electron-builder for installer, sidecar resources, signing, and later update support.
2. Authenticated loopback frontend versus packaged secure custom protocol for static assets.
3. NSIS/per-user installer versus another Windows installer target; whether a portable ZIP remains supported.
4. Whether the secondary HDR preview window is included before the first Electron preview or immediately after it.
5. Recovery snapshot location, retention count, maximum size, and privacy copy.
6. Whether source-file change detection belongs in this sprint or a later upstream-editor integration sprint.
7. Minimum supported Windows and macOS versions after considering Electron, Python, native encoders, and HDR requirements.

## 12. Windows MVP implementation record — August 16, 2026

The first implementation uses Electron 43.4.0 with electron-builder 26.15.3 and retains the authenticated loopback FastAPI renderer transport. Electron launches a windowless PyInstaller folder-mode backend on an atomically selected loopback port, verifies protocol/application versions, injects the authoring credential only for the exact application origin, and owns shutdown/process-tree cleanup.

Delivered MVP desktop workflows:

- sandboxed, context-isolated renderer with a versioned preload capability object;
- native source import, project open/relink, Save, Save As, export filename, and export-folder dialogs;
- direct load-by-path guarded by short-lived intent-scoped backend grants;
- standard File/Edit/View/Window/Help menus, accelerators, single-instance focus, `.hdrfinisher` routing, recent projects, dirty document titles, and dirty-close Save/Discard/Cancel handling;
- native drag/drop path resolution, reveal/open completed export actions, taskbar export progress, structured backend logs, and bounded window restoration;
- short-lived read-only proof URLs that open in the default browser without exposing authoring APIs;
- Windows x64 unpacked, NSIS Setup, and portable artifacts containing Electron, the Python backend, encoders, licenses, and notices.

Packaging decision: electron-builder was selected because it covers NSIS, portable artifacts, sidecar resources, file associations, later signing, and update metadata with one configuration. The first NSIS package is per-machine because electron-builder's standard Windows file-association support requires that mode. A future custom HKCU registration pass can restore the original per-user installer preference if avoiding elevation outweighs standard association handling.

Validation evidence is recorded in [Electron Desktop Wrapper Validation — 2026-08-16](../testing/Electron_Desktop_Wrapper_Validation_2026-08-16.md). Recovery snapshots, automatic updates, optional second-display preview, richer notifications/diagnostics, and macOS adaptation remain follow-on hardening rather than blockers for the Windows MVP workflow.

Installed-app acceptance was confirmed on August 16, 2026. Native adjustment and export workflows operate successfully in the NSIS-installed application. A console-window flash discovered during the first 0.3.0 hands-on pass was traced to the external `avifenc` preview process and corrected in 0.3.1 by applying Windows hidden-process flags to every bundled encoder/decoder invocation. The owner confirmed the updated installed application no longer flashes and that export completes successfully. This closes the Windows MVP functional acceptance gate; broader format/display testing and visual branding remain follow-up work.

### JPEG Ultra HDR Apple delivery finding — further testing required

An exported JPEG Ultra HDR file displayed as HDR in local Chromium and passed the bundled libultrahdr probe. Structural inspection found an SDR primary JPEG, a full-resolution embedded gain-map JPEG, Ultra HDR v1 XMP, ISO 21496-1 metadata, and a valid sRGB base profile. Uploading the file to Google Drive and downloading it again on Windows preserved the exact `59,345,442` bytes and SHA-256 hash `7392D585865591FFD3493E9D49F27C7FB1DAA59D81F29DE2E68BCBD927DED1F4`, ruling out server-side Drive recompression in that round trip.

The first iPhone Photos presentation appeared SDR after the Google Drive workflow. However, saving a version from the Photos roll back to the Files app and viewing it with Preview displayed the image in HDR to the owner's visual assessment. In Files/Preview, the owner also observed visible banding in the test image's sky. Apple reported **Depth: 8** and the color profile as **sRGB Gamut with sRGB Transfer**. Those properties are consistent with the 8-bit sRGB primary JPEG and do not by themselves prove that Preview discarded the separate gain map, but the banding may indicate gain-map/base quantization, reconstruction behavior, or an intermediate Photos rewrite and requires image-level comparison.

This is evidence that an Apple decoder can recover and present an HDR rendition somewhere in the round trip, but it does not yet establish whether Photos initially selected the SDR base, the Drive-to-Photos handoff changed the asset, an application/display setting affected presentation, or Photos rewrote the file into a more Apple-compatible representation when exporting it.

As a positive control, an AVIF gain-map export downloaded directly from Google Drive into iPhone Photos displayed correctly and with subjectively strong image quality. This narrows the observed problem to the JPEG Ultra HDR workflow or its Apple presentation/import handling rather than HDR display being generally unavailable on the device. Preserve the exact AVIF artifact and its export settings for repeat testing and metadata comparison.

Instagram on iOS recognized both the JPEG Ultra HDR and AVIF gain-map files as HDR during the post-editing workflow. This provides an additional positive signal that both exported artifacts contain HDR information usable by at least one third-party iOS application, including the JPEG that Photos initially appeared to present as SDR. Record this separately from delivery success: recognition in Instagram's editor does not yet prove that the published post, Instagram's server-side derivatives, subsequent viewers, or downloads preserve the HDR rendition. Future testing should cover draft reopen, publication, viewing from HDR and SDR devices/accounts, and any downloaded derivative.

Keep this open as an interoperability investigation rather than classifying it as a confirmed encoder failure. Repeat the workflow while recording the iPhone model, iOS version, HDR viewing setting, transfer action used at each boundary, destination application, reported bit depth/profile, and whether the presentation survives an application relaunch. Compare file size and hash before upload, after desktop Drive download, after iPhone download when accessible, and after Photos-to-Files export. Add iCloud Drive or AirDrop as a control path. Inspect the Photos-exported file for container layout, gain-map dimensions, Ultra HDR v1/ISO metadata, color profile, and reconstruction parameters. Compare the same sky region at matched scale in the original SDR base, local Chromium HDR reconstruction, iPhone Photos, and Files/Preview; capture screenshots only as presentation evidence because screenshots may introduce their own tone mapping or quantization. Then test gain-map quality/resolution, an even-dimension export, and a less-extreme gain range if Apple behavior remains inconsistent.

Treat these observations and subsequent device/service tests as inputs to a future **recommended export settings by use case** guide. Recommendations must identify the intended destination and fallback requirement—for example Apple Photos delivery, Instagram/social publishing, Chromium/web delivery, Android gallery compatibility, archival/master exchange, or maximum legacy JPEG reach—and should include format, gain-map quality/resolution, color/profile expectations, known transfer paths, verified applications/OS versions, ingest/editor recognition, published-result behavior, visible failure modes, and the preferred fallback. Do not present a format as universally compatible based on one successful decoder or device.

## 13. Source references

- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron security recommendations](https://www.electronjs.org/docs/latest/tutorial/security)
- [Native dialogs](https://www.electronjs.org/docs/latest/api/dialog)
- [IPC and narrow preload bridges](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [OS-backed dropped-file paths](https://www.electronjs.org/docs/latest/api/web-utils)
- [Application lifecycle, single-instance, and GPU diagnostics](https://www.electronjs.org/docs/latest/api/app)
- [Display metadata](https://www.electronjs.org/docs/latest/api/structures/display)
- [Recent documents](https://www.electronjs.org/docs/latest/tutorial/recent-documents)
- [Windows taskbar integration](https://www.electronjs.org/docs/latest/tutorial/windows-taskbar)
- [Application progress](https://www.electronjs.org/docs/latest/tutorial/progress-bar)
- [File-manager and external-browser integration](https://www.electronjs.org/docs/latest/api/shell)
- [Deep links](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app)
- [Automatic updates](https://www.electronjs.org/docs/latest/api/auto-updater)
- [Crash reporting](https://www.electronjs.org/docs/latest/api/crash-reporter)

---

*This sprint document began as an execution plan and now also retains the resulting Windows MVP decisions, measurements, validation evidence, and implementation references.*
