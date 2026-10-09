# HDR Finisher 0.9.0 — draft for review

Prepared October 7, 2026; renumbered 0.9.0 on October 8 (Steve); rewritten October 9 as a summary of the major changes since 0.8.12. This draft does not announce a published release, and the pre-release validation sweep has not been recorded here yet.

0.9.0 is the largest update so far: about 400 changes since 0.8.12. The headlines are a preview that shows real full-resolution detail, much faster editing on large files, several new tools, and a codebase reorganised so it is easier to work on.

## Full-resolution preview

- The preview now shows true source detail when you zoom in. At 100% and above you are looking at the real pixels of the file, not an enlarged smaller copy, and above 100% each pixel is drawn as a sharp square.
- Only the part of the picture on screen is processed, at the detail the current zoom needs. That is what makes native detail practical on 40-megapixel files without running out of graphics memory.
- Large pictures are rendered in tiles when they would not fit in graphics memory in one piece. Masks, local adjustments, Detail, Denoise, Film Look and Vignette all work on that path and match the single-pass result.
- If the graphics device fails, the app rebuilds it and carries on instead of dropping to the slow CPU preview for the rest of the session.

## Performance

- Panning at 100% no longer downloads the view again for each move: on a 42 MP test file a pan went from about 0.4 s to about 0.16 s.
- Zooming to a new size is about twice as fast the first time (for example 2.3 s to 1.2 s at 50% on a 42 MP file), and sizes you have already visited are kept on disk between sessions.
- RAW import is faster: lens correction now uses several processor cores, taking a 42 MP import from about 11.7 s to 7.6 s.
- Sliders settle when you let go instead of re-rendering values already on screen, and a single "Faster dragging" option replaces the old preview modes for slower computers.
- Local adjustment masks, including feather, edge shift, straightened and perspective-corrected masks, are now built on the graphics card rather than fetched from the slower CPU path.
- SDR Match renders its trial versions on the graphics card.
- Scopes stay live while you drag and stay on the graphics card when you switch between HDR and SDR.

## New tools

- **Before / After.** View > Preview Compares switches the compare tools between HDR / SDR and Before / After. Tap V to switch to the picture as it was imported, hold V to peek, or use a split layout with Before on one side and your grade on the other.
- **Black & White.** A new module with eight colour sliders that set how bright each colour becomes in grey.
- **Denoise, rebuilt.** One adaptive method that measures the noise in your file, with separate controls for four sizes of noise and a Show noise view that displays only what is being removed. The earlier wavelet method has been removed.
- **Film grain, rebuilt.** A more physical grain with a black-and-white film type and a grain map view.
- **Vignette.** Horizontal and Vertical Scale, an on-picture outline of where the vignette starts and ends, and Amount can be typed up to 200% either way.
- **Local Adjustments eye.** One eye switches every local adjustment off or on, in the preview and in export, like the other modules.
- **Navigate window.** Appears for any zoom closer than Fit, sits clear of the scroll bars, handles very wide and very tall pictures, and can be set to Always Show, Auto or Off from the View menu.
- **Revert HDR and Revert SDR** in the File menu return one rendition to its starting state.
- **Typed values everywhere.** Every number beside a single slider can now be typed, and 55 grading controls accept typed values beyond the ends of their slider. The full list is in the typed values reference.

## Refinements

- Perspective has a responsive draft while you work; Apply makes it permanent and leaving the tool cancels it. Its guides stay on the picture when you zoom.
- Softness and Microcontrast moved from Film Look to Detail. Halation, Bloom and Diffusion no longer echo bright highlights.
- One status bar reports everything the app is doing. When there is too much to show, the most urgent messages stay and the rest fold into a "+N more" marker. Export reports a short completion message.
- False Color applies its opacity evenly across every brightness band.
- Path feather keeps the same falloff at every zoom, and luminance-mask feather matches between preview and export.
- The viewer stays inside its panel in narrow windows.

## Under the hood

- The frontend has been reorganised from two very large files into about 70 focused ones (the main file alone was over 19,000 lines). Nothing about how the app behaves changed; the point is that each part can now be read, checked and changed on its own, by a person or by an AI model.
- A code audit removed unused and legacy code: the old SDR renderer, the first version of SDR Match, wavelet Denoise and the old-preferences conversion.
- Automated checks now test what the app produces rather than the wording of its code, and a new in-app check covers the viewer tools.

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
