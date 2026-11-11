# HDR Finisher 0.9.2

0.9.2 improves Library browsing, adds grading and Retouch controls, and brings export and Proof onto the graphics card with a CPU fallback.

## Photo Library

- Build previews for a selection, browse saved screen previews, and return from Grade to the updated picture. Camera RAWs show a camera preview first when no finished thumbnail is available.
- Paste selected parts of a saved grade and export several versions through the batch queue. Batch exports include metadata and privacy choices.
- Smart Albums show their saved matches immediately and refresh in the background. Focus and Exposure overlays can use undeveloped RAW camera previews.
- Improved folder commands, virtual-copy handling, fullscreen navigation and background memory management.

## Grading and Film Look

- Blacks, Shadows, Midtones and Highlights with Center and Width replace the earlier tone controls. Color adds highlight and shadow desaturation.
- Local hue-selection masks and Global HSL share Edge, Feather and Edge detail controls.
- Retouch provides Inpaint, Heal and Clone. Heal and Clone take a source click followed by a destination click or stroke; labelled circles let you move a selected repair.
- Presets can be renamed, updated, imported and exported. Film Look uses one Format dropdown.

## Export and Proof

- GPU delivery handles export, batch export and Proof, with a CPU fallback. Full-size Proof shares the export render.
- Export progress appears in the status bar; the detailed log is under Advanced settings.

## Refinements

- A black startup splash, revised application menus and consistent controls, graphs and lists. Selected buttons use a pressed plate.
- Context-sensitive keyboard hints appear in the status bar. Navigate can be moved by its title bar.
- Improved JPEG XL colour-tag handling and threaded CPU decoding for supported ProRAW linearization tables.

<!-- coordinator: add sprint fixes -->

## Changed or removed

Earlier tone controls and retired settings are not migrated before 1.0. Review older grades after opening them. Removed Film Look Format shortcut buttons are replaced by the dropdown.

## Known limitations

This remains a technical alpha. Windows packages are unsigned; macOS packages are not notarized. Film-stock preview/export differences at the GPU half-precision limit remain open. Retouch's final quality review, some Library responsiveness targets and physical platform HDR qualification remain incomplete. GPU export repeatability is under review in this sprint; these draft notes do not claim release validation has passed.

See [Known limitations](https://github.com/LucienMidnight/hdr-finisher/blob/v0.9.2/docs/known-limitations.md) for support and validation status.

**Full changelog:** https://github.com/LucienMidnight/hdr-finisher/compare/v0.9.1...v0.9.2
