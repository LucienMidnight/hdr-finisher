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

## v0.6.0 release validation — 2026-08-21

The Apple Silicon package was rebuilt from `main` commit `2604714` after the v0.6.0 Windows release work landed. The existing arm64 native encoder tools were reused; the packaged capability check confirmed that `avifenc`, `avifdec`, `avifgainmaputil`, and `ultrahdr_app` were present and available in the final app bundle.

- PyInstaller rebuilt the private v0.6.0 backend, and Electron Builder produced the arm64 app, DMG, and ZIP.
- The deterministic Python suite passed with 595 tests passed and 3 skipped. The desktop unit suite passed 7/7.
- The packaged Electron smoke test passed source upload, filesystem and pathless drops, staged open, metadata verification, project save, SDR export, capability discovery, and shutdown.
- Strict deep code-signature verification passed for the locally ad-hoc-signed app. `hdiutil verify`, ZIP integrity testing, and SHA-256 manifest verification all passed.
- The product owner confirmed that the DMG installer works on Apple Silicon macOS. This confirms the basic hands-on installation gate, but does not by itself complete the representative-media or physical HDR display matrix above.
- `HDR-Finisher-0.6.0-macOS-arm64.dmg` is 196,123,541 bytes with SHA-256 `d63ba76e2dcf3ad2bf80a6dad5723373954426d483fb79738e04b7bb37318100`.
- `HDR-Finisher-0.6.0-macOS-arm64.zip` is 197,138,178 bytes with SHA-256 `57ea7848e4dc11dcf39c015571e4779ca85c4274bac02c6820c374c7be27d44c`.

Developer ID signing/notarization, Intel compatibility, representative-media acceptance, and physical HDR display conclusions remain separate release gates. v0.6.0 remains an unsigned technical preview.
