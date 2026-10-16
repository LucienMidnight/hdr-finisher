# HDR Finisher 0.9.1

0.9.1 adds a Photo Library for browsing and organising your pictures, and rebuilds Film Look with a larger choice of film stocks, print papers and lens filters.

## Photo Library

- Browse pinned folders in a thumbnail grid or filmstrip, open a single picture, or review full screen. Zoom in to inspect real detail, and compare two pictures with linked zoom and position.
- Organise pictures with stars, colour labels, tags, manual albums and smart albums that follow your filter rules. Duplicate albums or turn a smart selection into a manual album.
- Check focus and exposure with overlays, including shadow and highlight warnings based on the source picture.
- Grades save in the background, with autosave status, recovery and conflict choices. Saved grades appear in Library pictures, and virtual copies let you keep several independent versions of a photo.
- Copy and paste selected parts of a grade, or revert a photo or copy. Rename, move and delete photos and folders through confirmed commands with recovery records.
- Background folder checks keep the Library current. Camera RAW browsing, read-ahead and reuse of pictures make moving between photos quicker, and edited Library pictures retain their HDR and SDR views.

## Film Look

- Choose from a library of negative and slide films, with stock-specific colour, tone, grain and character. Film Looks combine a stock with selected creative changes, and stage presets let you reuse individual parts of a look.
- Five folding stages follow the picture through camera, development, printing and scanning. Push/Pull, print exposure, print contrast, shadow and highlight contrast, paper choice and scanner controls shape the result.
- Film effects now follow their physical order. Grain at Fit reflects the downsized film scan, and halation favours red light as it would after reflection through the film base.
- Black Pro-Mist, Pro-Mist, Glimmerglass and CineBloom lens filters provide different kinds of glow, with Strength and Size controls.
- Stock-owned controls show which values belong to the selected stock and which you changed, with reset dots to return to the stock value.

## Refinements

- New branding, a tighter header, and Library and preset controls styled to match the side panels.
- Grade loading appears immediately when opening a Library photo, and the preview retries on the graphics card when loading a film stock interrupts its first draft.
- Recent projects in the File menu and header reopen your last ten projects, including ones saved with Save As. Drag in the navigation window to pan, and the RAW only filter is back beside HDR in the Library toolbar.
- Fixes for Black and White on large tiled pictures, Library tags and albums saving reliably, and Match no longer applying a late reply to the next photo.
- Neutral Film Look retains weak colour channels and a wider range before HDR highlight compression. Extremely bright, uncompressed grades still have the preview limit described below.

## Changed or removed

Bloom has been replaced by the lens filters. Projects or presets that used removed settings, including earlier Film Look controls, must be recreated. Before 1.0, removed settings are not migrated.

## Known limitations

This remains a technical alpha. Windows packages are unsigned; macOS packages are not notarized. Very bright uncompressed HDR grades can exceed the preview's numerical range and show clipped colours or white patches; CPU export and Proof remain the reference. The widest lens-filter glows have bounded tails. Preview/export differences and other retained checks are recorded in Known limitations; release validation status is recorded there separately from these draft notes.

See [Known limitations](https://github.com/LucienMidnight/hdr-finisher/blob/v0.9.1/docs/known-limitations.md) for support and validation status.

**Full changelog:** https://github.com/LucienMidnight/hdr-finisher/compare/v0.9.0...v0.9.1

# HDR Finisher 0.9.0

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

## Downloads

- Windows x64: Setup installer and Portable executable.
- macOS Apple Silicon: DMG and ZIP packages.
- Linux x86_64: Debian and Flatpak packages.
- SHA-256 checksum manifests are included for each platform.

Release automation builds, tests, and verifies the platform packages before publishing.

## Known limitations

This remains a technical alpha. Windows packages are unsigned; macOS packages are not notarized.

Preview/export and cross-scale differences, a few pixel-parity checks, and measured responsiveness target misses remain recorded in the viewport-preview PRD. This release does not claim that every guard passes. Linux HDR can show gradient banding on the documented KDE/Wayland NVIDIA path; X11/Xwayland uses SDR simulation. RAW and Experimental DNG Import retain their documented compatibility limits.

See [Known limitations](https://github.com/LucienMidnight/hdr-finisher/blob/v0.9.0/docs/known-limitations.md) for the full support status.

**Full changelog:** https://github.com/LucienMidnight/hdr-finisher/compare/v0.8.12...v0.9.0
