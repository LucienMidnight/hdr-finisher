# HDR Finisher 0.8.1

HDR Finisher 0.8.1 adds Linux x86_64 desktop support with Kubuntu 26.04 LTS, Plasma 6.6, and native Wayland as the tier-one HDR environment. It supersedes the unpublished 0.8.0 release candidate after correcting Linux CI so pinned native encoders are built before encoder-dependent tests run.

- Adds a versioned Debian package and a sandboxed Flatpak/Flathub manifest.
- Qualifies Linux HDR presentation only when native Wayland, browser-reported HDR, and an extended `rgba16float` WebGPU canvas are active.
- Keeps editing, scopes, proof reconstruction, and export available with a persistent non-authoritative SDR preview warning in degraded modes.
- Reports the current Electron display label, color space, output/component depth, scale, session type, and distribution channel without inventing peak luminance.
- Reconfigures the WebGPU surface when display state or browser HDR/gamut media queries change.
- Adds pinned Linux builds for libavif tools and `ultrahdr_app`, ELF dependency checks, offline Flatpak dependency manifests, XDG portal-safe permissions, AppStream/MIME metadata, and Linux CI jobs.

Hands-on validation on August 31, 2026 passed the application's complete Linux HDR presentation gate on Ubuntu 26.04.1 LTS, KDE Plasma, native Wayland, and a 10-bit Xiaomi HDR display. The Technical panel reported **HDR Presentation: Qualified**, **Dynamic Range: high**, a Display P3 extended WebGPU canvas, GPU texture transport, and a 16-bit float preview proxy. This validates the application presentation path on the tested workstation; it is not a photometric calibration or measured peak-luminance certification. AMD Mesa and Intel Xe remain explicitly unqualified until corresponding hardware results are recorded.

Known Linux follow-ups do not block this technical-alpha release: the empty launch state can briefly report an SDR simulation before any preview surface has been attempted, KDE may show a blank taskbar tile because the Wayland application identity is not yet associated correctly with the installed icon, and mounted external storage is reachable through the filesystem browser but is not yet promoted automatically into **Locations**.
