# HDR Finisher 0.9.0 — draft for review

Prepared October 7, 2026; renumbered 0.9.0 on October 8 (Steve). This draft does not announce a published release.

- Editing previews process the visible area at the detail needed for the current zoom, including native detail at 100% and above. GPU memory admission and tiled rendering keep large-image editing bounded.
- Denoise uses one adaptive method, with bounded viewport work and cached tiles during grading. The earlier wavelet method has been removed.
- Perspective has a responsive GPU draft. Apply rebuilds the authoritative preview; leaving the tool cancels unapplied changes.
- The viewer stays inside its panel in narrow windows. GPU scopes remain current across lane switches, and interrupted preview work no longer triggers avoidable CPU settling.
- Revert HDR and Revert SDR in the File menu restore the selected lane to its untouched starting state.
- Tiny images export without rejected preview requests. Technical processing labels follow the frame on screen, and display capability changes rebuild the preview surface.

## Project compatibility

Before 1.0, retired adjustment fields and preferences are ignored rather than migrated. Older projects using wavelet Denoise open with the current adaptive method; retired SDR Match recipes are not preserved. Review those projects after opening.

## Known limitations

This remains a technical alpha. Windows packages are unsigned; macOS packages are not notarized.

Preview/export and cross-scale differences, a few pixel-parity checks, and measured responsiveness target misses remain recorded in the viewport-preview PRD. This release does not claim that every guard passes. Linux HDR can show gradient banding on the documented KDE/Wayland NVIDIA path; X11/Xwayland uses SDR simulation. RAW and Experimental DNG Import retain their documented compatibility limits.

See [Known limitations](docs/known-limitations.md) for current support status.

---

# HDR Finisher 0.8.12

HDR Finisher 0.8.12 tightens the frontend pipeline and makes local mask controls respond directly and predictably while editing.

- Replacing a source now retires the previous backend session cleanly and prevents stale requests from restoring superseded state.
- Preview-resolution and source-disclosure controls stay synchronized with the active pipeline state.
- Path-mask drawing follows the cursor through viewer geometry transforms, keeps the live segment visible, and shows feather feedback immediately during interaction.
- Path gizmos remain aligned after crop, rotation, perspective, zoom, and viewer-fit changes.
- Gradient-mask luminance selection is now a single grayscale rail with four handles, live EV readouts, and a clear selected-range fill.
- Control-panel luminance adjustments and on-image mask feedback now update through the same state synchronization path.
- Browser interaction coverage now exercises source replacement, transformed path drawing, feather feedback, pipeline controls, and all four luminance handles with real pointer input.
- False Color now applies its selected opacity uniformly across every luminance band. New projects start at 50%; existing projects retain their saved opacity, so previously saved overlays may appear stronger in dark regions.

## Downloads

- Windows x64: Setup installer and Portable executable.
- macOS Apple Silicon: DMG and ZIP packages.
- Linux x86_64: Debian and Flatpak packages.
- SHA-256 checksum manifests are included for each platform.

Release automation builds, tests, and verifies the platform packages before publishing.

## Known limitations

This remains a technical-alpha release. Windows artifacts are unsigned. macOS packages are ad-hoc signed and are not notarized.

Capture sharpening is evaluated at 1:1. Below roughly 38% of full resolution the radius compensation reaches its floor, so preview sharpening is coarser relative to the frame than the export's. The output limiter is unaffected by this.

Linux HDR preview can show visible gradient banding on the documented KDE/Wayland NVIDIA path; this does not by itself indicate banding in high-bit-depth exports. X11/Xwayland uses an explicit SDR simulation. RAW development remains a constrained beta, and difficult clipped highlights can retain color artifacts.

See [Known limitations](https://github.com/LucienMidnight/hdr-finisher/blob/v0.8.12/docs/known-limitations.md) for the full support status.

**Full changelog:** https://github.com/LucienMidnight/hdr-finisher/compare/v0.8.11...v0.8.12
