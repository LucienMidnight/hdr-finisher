# HDR Finisher 0.8.10

HDR Finisher 0.8.10 makes Automatic Match reproduce the HDR grade faithfully in the SDR lane, keeps geometry and preview resolution stable across viewer transitions, and reports renderer failures the renderer cannot report itself.

- Automatic Match now solves for the SDR Color Grading wheel angle and saturation that reproduce the HDR tint, instead of copying the numbers across. The two lanes build tint direction in their own primaries and neutralize it with their own luma weights, so identical numbers were a different color in each: up to 16 degrees of drift on the green/magenta axis and up to twice the strength. Hue error now stays under 0.3 degrees.
- Match fits saturation and vignette on separate axes. The previous combined grid paired every saturation offset with a scaled-away vignette and never trialled the authored vignette at full strength, so an accepted trial could halve or erase a vignette that had just been copied correctly.
- Perspective guides stay on the source lines they were placed on after a solve applies. The solve returns a guide transform and carries applied guides through it, compensating the differing normalized X/Y pixel scales on non-square images so roll stays a rigid rotation.
- Geometry map responses carry full-resolution output dimensions, resolved without allocating an image.
- Returning from comparison, ending a comparison peek, or cancelling an unchanged Perspective draft keeps the refined preview. `showCachedPreview` requested a GPU draft with no explicit resolution and fell back to the display-bounded settled proxy, which could strand a 4096 target at 634x976 with no refinement scheduled.
- Renderer crash and gone events are recorded to a desktop log alongside app and Electron versions, and the close path short-circuits once the window has failed rather than offering to save through a renderer that can no longer answer.
- The local mask gizmo is confined to the Grade stage. Proof and Export reuse the same preview element, so a gradient or brush gizmo could stay painted over the proofed image and keep capturing pointer input.
- Overlays, Preview and Frame use the same dividers as every other viewer tool group boundary, and the zoom readout fits four digits plus the percent sign.

## Downloads

- Windows x64: Setup installer and Portable executable.
- macOS Apple Silicon: DMG and ZIP packages.
- Linux x86_64: Debian and Flatpak packages.
- SHA-256 checksum manifests are included for each platform.

Release automation builds, tests, and verifies the platform packages before publishing.

## Known limitations

This remains a technical-alpha release. Windows artifacts are unsigned. macOS packages are ad-hoc signed and are not notarized.

Linux HDR preview can show visible gradient banding on the documented KDE/Wayland NVIDIA path; this does not by itself indicate banding in high-bit-depth exports. X11/Xwayland uses an explicit SDR simulation. RAW development remains a constrained beta, and difficult clipped highlights can retain color artifacts.

See [Known limitations](https://github.com/LucienMidnight/hdr-finisher/blob/v0.8.10/docs/known-limitations.md) for the full support status.

**Full changelog:** https://github.com/LucienMidnight/hdr-finisher/compare/v0.8.8...v0.8.10
