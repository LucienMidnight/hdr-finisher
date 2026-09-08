# HDR Finisher 0.8.11

HDR Finisher 0.8.11 brings the Proof page back in line with the Grade view. Sharpening no longer produces unbounded halos that hijacked the export's highlight anchor, and the output target is now a guarantee rather than an aim.

- The Proof page no longer diverges from the Grade view in the 400-1000 nit band. Sharpening ringing had been setting the export's Peak Fit anchor, putting it 1.85 stops away from the preview's and silently moving an authored 400 nit shoulder to 154 nit, which cost 28% of the luminance and 23% of the saturation in that band. Both engines now honour the authored shoulder.
- Output target is an unconditional ceiling. Peak Fit and Soft Ceiling both end at the target in the delivery primaries, so a technical delivery spec holds regardless of what Detail, Film Look, grain or output finishing add downstream. A shoulder anchored on a measured peak cannot promise the target on its own.
- Sharpening no longer produces unbounded halos. The halo fence scaled its allowance by the local neighborhood range against a log floor at 1e-7, so any pixel beside a near-black sample reported a twenty-stop range and the fence stopped bounding anything; ringing reached +4.27 stops. The excursion is now capped at 0.25 EV with a raised luminance floor. Sharpening coverage and response to Amount are unchanged, and the peak no longer moves with Amount at all.
- The SDR lane applies its highlight shoulder exactly once. The WebGPU preview had gained a second application for scene-referred sources. The SDR shoulder stays where it is, since it is the scene-to-display placement that fits the remaining scene headroom rather than a limiter, and receives the output ceiling alone.
- Scopes read the same finished render target the viewer presents, instead of recomputing Film Look, so scopes and the presented frame agree by construction.
- The preview still anchors Peak Fit on a source-domain estimate rather than the finished picture, so a grade with heavy Film Look or local work can still show a small difference against the proof in the top stop. Measuring the finished picture in the preview needs the render scheduler to request a refinement after the measurement lands, and is deferred.
- Export clips after output finishing, so output sharpening lands under the ceiling instead of on top of it.

Grading latency is unchanged.

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

See [Known limitations](https://github.com/LucienMidnight/hdr-finisher/blob/v0.8.11/docs/known-limitations.md) for the full support status.

**Full changelog:** https://github.com/LucienMidnight/hdr-finisher/compare/v0.8.10...v0.8.11
