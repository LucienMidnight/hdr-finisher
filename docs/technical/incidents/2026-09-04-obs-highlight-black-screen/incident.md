# Installed 0.8.8 black-screen incident

## Report

User was recording with OBS, disabled RAW highlight reconstruction, then disabled highlight compression. Zoom stopped working. After stopping OBS recording, the entire application window went black; the monitor and desktop remained normal. The window can still be moved/minimized. The installed HDR Finisher instance was left running for investigation. User screenshots confirm all renderer content is absent; see `black-app-window.png`.

## Captured evidence

- Installed executable: `C:\Program Files\HDR Finisher\HDR Finisher.exe`, version 0.8.8.0; main app and backend started at 03:04 on September 4, 2026 (machine local time).
- Backend health at `http://127.0.0.1:59782/health` returned status `ok`, version `0.8.8`, protocol `1` during investigation.
- Backend log has no error after the current instance's ready message. This log does not capture renderer or GPU-process errors, so it cannot rule those out.
- OBS recording started at 03:07:48.814 and stopped normally at 03:19:01.909. NVENC AV1 recording, 2560x1440, DXGI display capture. No device-loss error appears in the captured OBS log.
- No matching Application Error, Application Hang, Windows Error Reporting, Display, NVIDIA/AMD display-driver, WHEA, or DxgKrnl events were returned for the bounded interval from 03:04 to evidence capture. Earlier WER entries reference older watchdog dumps and are not evidence for this incident.
- SHA-256 hashes of installed `frontend/app.js` and `frontend/webgpu-preview.js` match workspace files; see `frontend-hashes.json`.
- Post-incident GPU telemetry: RTX 4070 Ti, driver 616.56, 1,266 MiB of 12,282 MiB used, 18% utilization, 50 C. These are later readings, not measurements during the failure.
- Copied backend and OBS logs and recorded process metadata. Did not restart or change the installed instance.

## Code paths and remaining uncertainty

- RAW reconstruction bypass calls `applyRawImportSettings`, which re-develops the source through an import job and activates a replacement session.
- Session activation clears preview state and resets GPU resources, then renders the new preview and waits for overlays/scopes.
- Highlight compression bypass follows the grading/preview path.
- The renderer has a `device.lost` handler and CPU fallback. No live renderer console/state was available to determine whether it fired, whether a request remained pending, or whether the compositor failed.
- The native Computer Use helper failed twice with `failed to launch codex app-server: The system cannot find the file specified. (os error 2)`. The saved DevTools port was also unreachable. No live window screenshot could be captured through those facilities.

## Follow-up findings

- Elevated read-only process enumeration identified main PID 13872, GPU PID 10092, NetworkService utility PID 1732, and backend PID 17704. No renderer process remained. The interface process has exited; this is not merely an image-preview failure. The original exit code/reason is unavailable because 0.8.8 did not log renderer exits.
- User also reported an incorrect clock and confirmed booting Linux immediately before Windows. At the initial check, `w32tm /stripchart /computer:time.windows.com /samples:1 /dataonly` measured +25200.419 seconds: Windows was seven hours behind. Windows was set to Bangkok UTC+7, `RealTimeIsUniversal` was absent, and Windows Time reported unsynchronized / Local CMOS Clock. This strongly supports a dual-boot UTC-versus-local hardware-clock mismatch, not evidence of an HDR Finisher clock change.
- The user manually resynchronized the clock during investigation. System event record 190327 attributes the resulting +25200415 ms change to `svchost.exe` PID 4624, ending at 10:29:28 local time. A later time-server check at 10:33:43 measured -0.007725 seconds. No clock-changing commands were issued by this investigation. Clock history is preserved in `clock-history.json`; event record order is more reliable than timestamps across this correction.
- The source desktop shell now records renderer/GPU exits in `logs/desktop.log`, starts local-only Crashpad collection, and presents a native error dialog with Keep Open, Open Logs, and explicit Quit. A failed renderer no longer receives an impossible Save-on-close request. No automatic reload or restart is performed because reconnecting a backend session is not yet implemented.
- Three focused unit tests pass. An isolated Electron 43.4.0 test deliberately terminated its own renderer and verified the native error options, crash log, healthy retained backend, and close handling. Test command: `node tests/renderer-crash.js` from the desktop directory, with `HDR_FINISHER_TEST_ELECTRON` pointing to the clean runtime under `codebase/output/renderer-crash-test/electron-43.4.0/electron.exe`. The installed instance remained untouched. The pre-existing node_modules runtime contains a review launcher that overrides the profile, so the final test used a clean runtime extracted from the existing Electron download cache.

## Remaining work

The original highlight/OBS trigger is still unconfirmed. The patch addresses missing diagnostics and silent failure handling; it does not claim to prevent the original renderer crash. No installed-package change has been applied. A future occurrence under an instrumented build is needed to obtain its exit reason and, where available, a local crash dump.
