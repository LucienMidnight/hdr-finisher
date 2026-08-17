# Electron Preview Correctness Validation — 0.3.5

**Date:** August 16, 2026
**Source branch:** `feature/electron-desktop-shell`; published to `main` after validation
**Build:** 0.3.5 x64, unsigned

## Automated evidence

- Python suite: 466 passed.
- Electron unit suite: 3 passed.
- Frontend/Electron sprint contract suite: 38 passed.
- Packaged backend sidecar: protocol 1, version 0.3.5, `/health` HTTP 200.
- Rotate-draft follow-up: a late settled-frame presentation no longer clears the temporary straighten transform before Apply or Cancel.
- Crop-performance follow-up: committed geometry is applied once to the WebGPU source proxy, cached by geometry signature, and reused for later RGB-primary and other GPU-supported grading changes.
- HDR-rotation follow-up: uncommitted HDR geometry uses a transient HDR presentation without mutating the session; Apply cannot disable WebGPU on an expected pre-commit geometry conflict.
- Manual source interpretation now reports the applied primaries and transfer instead of claiming automatic detection.
- Local adjustment influence and red-mask overlays now remain source-anchored through rotate, flip, straighten, and crop; authoring after geometry uses the exact bidirectional source/display map.
- Interactive and settled proxy swaps retain one viewport aspect for the active geometry signature, preventing small image shifts during color-wheel and curve drags.
- The export cards retain AVIF and JPEG Ultra HDR capability status but no longer claim `Mainstream alternative` or `Provisional default` rankings.
- PyInstaller folder build, electron-builder unpacked build, NSIS build, and portable build completed.
- `git diff --check` reported no whitespace errors.

The Playwright Electron smoke could not attach on this workstation because Chromium's GPU subprocess repeatedly exited with Windows status `0xC0000135`; forcing the GPU in-process allowed a manual launch but is incompatible with that Playwright attachment path. Treat the installed workflow as pending rather than passed.

## Tomorrow's installed-app check

1. Install `HDR-Finisher-Setup-0.3.5-x64.exe`; expect an unsigned Windows warning.
2. Confirm **Edit > Rendering Mode** is exclusive and persists Auto, GPU Preferred, and CPU Compatibility after restart.
3. Import an asymmetric image. Rotate 90°, Apply, then switch HDR → SDR → HDR. Confirm the visible frame and dimensions switch immediately.
4. On an HDR display, confirm highlights remain HDR-bright both before and after clicking Rotate Apply, while the HDR scopes remain unchanged except for geometry.
5. Open split vertical, split horizontal, side-by-side, and stacked comparisons. Confirm both lanes share geometry and landmarks.
6. Enable High-res Preview after rotation and crop. Confirm the toolbar changes from Refining to High-res/Source-limited/Fallback with an actual pixel long edge.
7. Cancel one Rotate draft and verify the committed frame is unchanged. Apply another draft and verify one rebuild follows.
8. Apply a substantial crop, then drag the RGB primary sliders repeatedly. Confirm the first post-crop preparation settles once and subsequent slider previews remain responsive.
9. Reset geometry, accept the confirmation, and verify rotation, flips, straighten, and crop all return to the imported frame.
10. Import, save/open a project, export PNG plus one gain-map format, restart, and uninstall.

## Artifacts

- `codebase/dist-electron-iteration-6-installer/HDR-Finisher-Setup-0.3.5-x64.exe` — SHA-256 `BB8C7A77D8EDF4184F7356DDC6FC9A4528CA96398A79F5FDFA05FAD2B1F899E6`
- `codebase/dist-electron-iteration-6-installer/HDR-Finisher-Portable-0.3.5-x64.exe` — SHA-256 `0FAD639C9ED4F06FE99A33A84840D594A206DC39E0F7E6EBB026E9D65618D975`
