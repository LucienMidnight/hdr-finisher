# macOS Desktop Validation

This is the durable acceptance checklist for the Apple Silicon desktop package. Generated logs, screenshots, exports, and smoke-test evidence belong under ignored `codebase/output/`.

## Automated gate

From `codebase/` on Apple Silicon macOS:

```bash
./tools/build_desktop_macos.sh
npm --prefix desktop test
npm --prefix desktop run test:packaged
.venv/bin/python -m pytest -q tests
```

Accept only when the native-tool build and tests pass, the packaged smoke test imports the deterministic PNG, saves a project, exports an SDR PNG, and the final `.app` contains an arm64 Electron executable, arm64 backend, and the four native encoder tools.

## Hands-on package gate

1. Mount the generated DMG and drag HDR Finisher to Applications.
2. Use Finder's one-time **Open** flow for the unsigned technical preview; do not disable Gatekeeper globally.
3. Import PNG, HEIC, TIFF, and EXR representatives with native panels and drag-and-drop.
4. Save, reopen from Finder, Save As, and confirm the edited-document dot and close-save prompt.
5. Export SDR PNG, JPEG Ultra HDR, and AVIF gain map; reveal each in Finder and verify the capability panel reports all bundled tools.
6. Close the last window, reactivate the Dock icon, and confirm a new window opens without a duplicate backend.
7. Quit with Command-Q and confirm no `HDR Finisher Backend` process remains.
8. Perform the display checks in [macOS settings](../setup/macos.md) on the intended HDR and SDR displays.

Signing/notarization, Intel compatibility, and physical HDR conclusions are separate release gates and must not be inferred from the automated smoke test.
