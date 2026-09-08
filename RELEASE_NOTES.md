# HDR Finisher 0.8.11

HDR Finisher 0.8.11 makes the Proof page match the Grade view. Highlight Compression is now a true final-output limiter: it anchors on the finished picture in both the WebGPU preview and the CPU export, and the output target is a guarantee rather than an aim.

- Peak Fit anchors on the finished picture in both engines. The preview previously measured the source through Tone and Color only, which is where the module used to sit, while export measured the finished image. On a representative grade the two anchors sat 1.85 stops apart, which silently moved an authored 400 nit shoulder to 154 nit and took 28% of the luminance and 23% of the saturation out of the 400-1000 nit band. Anchor divergence is now 0.175 stops, and the proof tracks the grade to within 0.33% luminance below 1000 nit.
- Output target is an unconditional ceiling. Peak Fit and Soft Ceiling both end at the target in the delivery primaries, so a technical delivery spec holds regardless of what Detail, Film Look, grain or output finishing add downstream. A shoulder anchored on a measured peak cannot promise the target on its own.
- Sharpening no longer produces unbounded halos. The halo fence scaled its allowance by the local neighborhood range against a log floor at 1e-7, so any pixel beside a near-black sample reported a twenty-stop range and the fence stopped bounding anything; ringing reached +4.27 stops. The excursion is now capped at 0.25 EV with a raised luminance floor. Sharpening coverage and response to Amount are unchanged, and the peak no longer moves with Amount at all.
- Highlight peak measurement defaults to Robust rather than Maximum. Robust is far steadier across the preview-to-export resolution change, and does not let a handful of ringing or grain samples define the shoulder for the whole picture. Existing projects keep their saved setting.
- The SDR lane applies its highlight shoulder exactly once. The WebGPU preview had gained a second application for scene-referred sources. The SDR shoulder stays where it is, since it is the scene-to-display placement that fits the remaining scene headroom rather than a limiter, and receives the output ceiling alone.
- Scopes read the same finished render target the viewer presents, instead of recomputing Film Look, so scopes and the presented frame agree by construction.
- Export takes its limiter anchor from the same point as the preview and clips after output finishing, so output sharpening lands under the ceiling instead of on top of it.

Grading latency is unchanged. A settled render performs one peak reduction and one readback, as before; an interactive drag performs none and carries the lane's last anchor.

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
