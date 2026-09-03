# HDR Finisher 0.8.8

HDR Finisher 0.8.8 fixes native macOS window controls and the application menu, and brings the latest editing, import, and theme improvements from main.

- Restores the native macOS title bar, traffic-light controls, and full-screen behavior, with the application menu in the macOS menu bar.
- Adds Default Light and Studio Gray themes and refines slider, toggle, and Film Look controls while keeping the viewer frame independent of the selected theme.
- Adds local mask sub-masks and keeps masks anchored to the image when crop geometry changes.
- Adds guided perspective correction separately from manual Straighten and a grain view map for inspecting Film Look grain.
- Selects the Apple HEIC gain map by auxiliary-image type for more reliable HDR import.
- Adds the camera-linear RAW import bridge with bypassable highlight reconstruction for supported Bayer and X-Trans sources.
- Unifies Highlight Compression across HDR and SDR, with Smooth color rolloff as the default Peak Fit behavior. Generated SDR uses the new curve; older projects retain their existing rendering behavior.

## Downloads

- Windows x64: Setup installer and Portable executable.
- macOS Apple Silicon: DMG and ZIP packages.
- Linux x86_64: Debian and Flatpak packages.
- SHA-256 checksum manifests are included for each platform.

Release automation builds, tests, and verifies the platform packages before publishing.

## Known limitations

This remains a technical-alpha release. Windows artifacts are unsigned. macOS packages are ad-hoc signed and are not notarized.

Linux HDR preview can show visible gradient banding on the documented KDE/Wayland NVIDIA path; this does not by itself indicate banding in high-bit-depth exports. X11/Xwayland uses an explicit SDR simulation. RAW development remains a constrained beta, and difficult clipped highlights can retain color artifacts.

See [Known limitations](https://github.com/LucienMidnight/hdr-finisher/blob/v0.8.8/docs/known-limitations.md) for the full support status.

**Full changelog:** https://github.com/LucienMidnight/hdr-finisher/compare/v0.8.7...v0.8.8
