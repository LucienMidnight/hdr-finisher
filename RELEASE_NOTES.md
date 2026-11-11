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

## Fixes

- Library rename, move and delete are about four times faster, and no longer hold up saving for as long.
- Switching photos quickly no longer lets a late Denoise result, source re-interpretation or Apply RAW settings land on the wrong photo.
- Cancelling a batch export can no longer be undone by a late Pause or Resume, and closing the app no longer leaves new exports waiting forever.
- The preview no longer hangs after a resize error, and Denoise no longer reuses the previous picture's noise measurement after the SDR base changes.
- Typing a percentage into a slider no longer jumps to the maximum.
- A normal graphics-memory hand-over between Grade and an export is no longer reported as an error.
- JPEG XL photos no longer make the Library stop drawing pictures (it kept relaunching a metadata reader while checking sizes).
- Choosing primaries and transfer by hand now clears the source review notice for linear and untagged TIFF or HEIC files, so they can be exported.
- After adding a tag in the Library, the tag field and its suggestions clear again.
- Save Project no longer gets stuck when a file name is typed before the folder list has loaded.
- On Linux, sorting a Library folder by name works again with older system SQLite versions.
- After using Denoise or Retouch, other Grade sliders respond about three times faster, and return to full speed when the tool is turned off.

## Changed or removed

Earlier tone controls and retired settings are not migrated before 1.0. Review older grades after opening them. Removed Film Look Format shortcut buttons are replaced by the dropdown.

## Known limitations

This remains a technical alpha. Windows packages are unsigned; macOS packages are not notarized. In HDR with Highlight Compression turned off, extremely bright grades (for example Exposure around +8, or several Film Look controls at their extremes together) can show magenta, green or white blotches in the brightest parts of the preview; export and Proof are correct. Retouch's final quality review, some Library responsiveness targets and physical platform HDR qualification remain incomplete. Two GPU exports of the same photo were once seen to differ; this did not reproduce in 0.9.2 testing and a check now watches for it. On macOS and Linux, JPEG XL files open with their size and bit depth, but their colour tags are not read yet: choose the primaries and transfer by hand in the source review notice (Windows reads them automatically).

See [Known limitations](https://github.com/LucienMidnight/hdr-finisher/blob/v0.9.2/docs/known-limitations.md) for support and validation status.

**Full changelog:** https://github.com/LucienMidnight/hdr-finisher/compare/v0.9.1...v0.9.2
