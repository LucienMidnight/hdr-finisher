# HDR Finisher 0.9.3

0.9.3 fixes the problems found when running HDR Finisher on an 8 GB MacBook, which is now the minimum supported machine, and keeps HDR exports at or just below their Highlight Compression target.

## Fixes

- Grade controls such as Exposure stopped responding at 100% zoom while the HSL colour picker was armed: the picker caught clicks meant for the controls. It now only takes clicks on the photo.
- HDR exports and Proof could come out brighter than the Highlight Compression target. Every HDR export and both Proof sizes are now checked after encoding; anything more than 1% over is corrected locally and lands at or just below the target. A file is refused only if it cannot be corrected, without replacing an existing file.
- On macOS, the app misread how much memory was free, so some photos (for example DJI drone DNGs) would not develop and Retouch refused work on 8 GB machines.
- On 8 GB Macs, zoomed Denoise and Film previews could be refused or never finish, and graphics-card exports fell back to the CPU: the app counted memory for a copy of the photo it never makes.
- A photo the Library could not develop was retried over and over; it is now remembered until the file or its grade changes.
- Export could stay on the CPU if it started before the graphics worker was ready.
- On Grade, zooming past Fit no longer hides the status line and the start of the scopes behind the side panel.

## Photo Library

- Rename, move and delete now work on macOS, using the Trash with Undo. Marks no longer wait while these run on any system.
- Much faster and steadier on 8 GB machines: memory used by heavy files is returned to the system, camera RAW previews come first, and visible thumbnails keep their priority. Scrolling a mixed 50-photo folder now shows 47–48 photos instead of 35, and most camera RAWs appear in under a second.
- No more long drawing gaps while browsing (graphics programs are prepared once).
- A lost graphics device gets one recovery, then the Library continues on the CPU.

## Grading

- HSL "Show selection" is faster: it only processes the part of the photo you can see.
- Film Look and lens filter drags are faster.
- Edge colour checks the graphics card's result and uses the CPU if it is invalid.

## Interface

- Page names (Library, Grade, Proof, Export) are flat tabs with an underline on the active page.
- Export settings are grouped into collapsible sections, like Grade's control panel.
- Scopes keep their collapse button clear of the other controls, can always be reopened, and fit with their labels on smaller screens.
- Cleaner panel borders and dividers, empty-state text for Folders and Smart Albums, and simpler selection styles for thumbnails and folders.
- The Updates panel links to GitHub Releases. The Linux HDR notice waits until a photo is open.
- JPEG XL files no longer hold up the Library if the metadata helper stalls (5-second limit).

## Changed or removed

The Default Dark theme is retired: Modern Dark is now the dark theme, and anyone using Default Dark moves to it automatically.

## Known limitations

This remains a technical alpha. Windows packages are unsigned; macOS packages are not notarized. Editing at 100% is still slow (about 2–4 seconds per change on an 8 GB MacBook) with many Film Look adjustments stacked together with Denoise; this is the next performance target. On 8 GB machines, very large EXR or gain-map AVIF files can wait a long time for memory in the Library. On some PC graphics cards, Edge colour on camera RAWs falls back to the CPU. In HDR with Highlight Compression turned off, extremely bright grades can show blotches in the brightest parts of the preview; export and Proof are correct. On macOS and Linux, JPEG XL colour tags are not read yet, and Library rename, move and delete are not available on Linux.

See [Known limitations](https://github.com/LucienMidnight/hdr-finisher/blob/v0.9.3/docs/known-limitations.md) for support and validation status.

**Full changelog:** https://github.com/LucienMidnight/hdr-finisher/compare/v0.9.2...v0.9.3
