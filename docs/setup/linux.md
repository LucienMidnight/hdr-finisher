# Linux and Wayland Setup

Kubuntu 26.04 LTS, Plasma 6.6, native Wayland, x86_64, and a physically connected HDR display form HDR Finisher's tier-one Linux environment. Recent Wayland compositors on other distributions are best-effort. X11 and Xwayland are supported for editing and export, not authoritative HDR presentation.

## Qualifying the viewer

HDR Finisher calls the Linux HDR viewer qualified only when all of these are true:

1. Electron is running natively in a Wayland session.
2. Chromium reports `(dynamic-range: high)` for the current display.
3. WebGPU successfully configures an `rgba16float` canvas with extended tone mapping.
4. Hardware GPU rendering remains available and the WebGPU device has not been lost.

The application rechecks the current display after window movement, resize, fullscreen changes, display hotplug, and display-metrics changes. If any condition fails, a persistent warning states that visible HDR brightness is an SDR simulation. Editing math, scopes, proof reconstruction, and exports are unchanged by this warning.

Electron exposes the display label, output color space, color depth, component depth, and scale factor. It does not expose dependable peak luminance, so HDR Finisher does not derive peak nits from the color-space name or EDID. On Linux, choose a fixed/custom proof target. Automatic measured-headroom proofing remains Windows-only in 0.8.0.

## Plasma configuration

1. At login, choose **Plasma (Wayland)** rather than an X11 session.
2. Open **System Settings → Display & Monitor → Display Configuration** and enable HDR for the HDR screen.
3. Keep the application window predominantly on the display being judged. Wait for the viewer warning/readout to update after moving it.
4. Confirm the Technical readout says **Native Wayland**, **Dynamic Range: high**, and **HDR Presentation: Qualified**.

Do not use the absence of a warning as a monitor calibration. Validate reference white, peak behavior, gamut, local dimming, and ambient-light conditions separately.

## Package behavior

The `.deb` uses native desktop file dialogs and checks GitHub releases. The Flatpak uses XDG file portals, has no `home` or `host` filesystem permission, and receives updates from the Flatpak store/software center. A portal document grant normally survives restart; if a project or source is moved or opened in the other package format, HDR Finisher asks you to relink it rather than broadening sandbox access.

Both packages use the same authenticated loopback sidecar and path-grant model. Network permission in the Flatpak is needed for loopback communication, the existing hosting probe, and explicitly requested external checks.

## Qualification status

Automated headless and X11 tests validate degradation, startup, export, and packaging, but cannot certify emitted luminance. Before a release is called physically qualified, record results for HDR on/off, fullscreen/windowed, SDR/HDR monitor movement, WebGPU device loss, and Linux-vs-golden exports on the target NVIDIA workstation. AMD Mesa and Intel Xe remain explicitly unqualified until corresponding hardware evidence is recorded.
