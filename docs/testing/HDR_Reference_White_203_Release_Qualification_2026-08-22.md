# HDR Reference White 203-Nit Release Qualification — 2026-08-22

## Local qualification status

This record distinguishes completed automated implementation evidence from physical-display acceptance. Local qualification used the repository's pinned `.venv`, Node 24.14.0, Electron 43.4.0, and the freshly built Windows package.

| Gate | Status | Evidence |
|---|---|---|
| Schema/runtime/import/render/proof/export tests | Passed | 597 passed, 1 skipped, 2 warnings in 34.20 s in the pinned `.venv` |
| Golden Pipeline PR tier | Passed | `rw203-v1-pr.json`; 359.07 ms; synthetic analytical journey |
| Golden Pipeline nightly tier | Passed with external fixture gap | 1,572.67 ms; authored AVIF gain-map and generated-SDR invariants passed |
| Golden real-photo journey | Not exercised | Approved licensed real-photo fixture is not present on this machine |
| JPEG Ultra HDR tools | Available | libultrahdr 1.4 capability probe |
| AVIF gain-map tools | Available | AVIF toolchain 1.4.1 capability probe |
| HDR JPEG XL runtime | Passed | Pinned `imagecodecs`/libjxl 0.11.2 tests and packaged capability probe |
| Desktop unit tests | Passed | 7 passed |
| Source Electron smoke/contract | Passed | Schema v3, 203-nit default, split false-color controls, import/save/export contract |
| Fresh Windows package and packaged smoke | Passed | Electron 43.4.0; JPEG Ultra HDR, AVIF gain map, and JPEG XL capabilities detected |
| WebGPU numerical/parity checks | Passed | peak relative error 0.0000217014; histogram 0.00065617; waveform 0.0005953266; vectorscope 0.0000567011 |
| Browser interaction sweep | Passed | All 16 scripts: reference-white entry, curves, lane round trip, exposure bands, local geometry/masks/graph, device loss, export/presets, startup and source disclosures |
| Windows external HDR visual/telemetry run | External qualification required | No physical-display evidence was captured by this automated session |
| macOS built-in/Apple HDR display | External qualification required | No macOS host or physical-display evidence available |
| macOS external HDR monitor | External qualification required | No macOS host, display, cable, or mode evidence available |

## Required Windows evidence

Use the validated external-display baseline of **SDR content brightness position 30 or 31**, approximately **200–204 nits** (`80 + 4 × position` on the validated Windows behavior). Record native SDR-white readback, display identity/HDR state, DXGI peak telemetry, Windows build, Electron/Chromium version, monitor mode, and a full application restart after applying the setting. Position 25/about 180 nits may be recorded as a deliberate mismatch, never as the release baseline. The setting materially affects Chromium HDR presentation but does not change project reference white, pixels, or export metadata.

## Required macOS evidence

Record Mac model, macOS version, built-in/reference preset or external display identity, HDR switch, cable/adapter, display mode, browser version, power state, and disabled True Tone/Night Shift/automatic brightness. macOS has no equivalent user-facing Windows SDR-white slider. Built-in/Apple HDR and external HDR-monitor runs remain distinct gates.

No physical-nit, Windows visual, or macOS visual pass may be inferred from analytical pixels, screenshots, capability probes, or the current Chromium 203-nit canvas convention.

## Numerical and performance evidence

- Deterministic patches reconstructed at 0, 0.1, 100, 203, 406, 1,000, and 12,000 nits; maximum patch error was below 0.000008 nit. The reference-switch ratios were 2.03000021, 2.02999997, and 2.02999997.
- Pure generated SDR and authored SDR were invariant across a reference-only switch (maximum delta 0). The fixed-nit representative recipe intentionally changed, with mean absolute delta 0.11899345.
- The synthetic scope peak was exactly 12,000 nits. Fixed false-color anchors were identical across the switch and source-proxy identity was preserved.
- Local-mask zoom wall time was 11.1 ms median / 11.2 ms p95. GPU opacity preview was 4.4 / 4.7 ms and feather preview 4.2 / 4.4 ms. With 64 local layers, submission was 2.0 / 2.3 ms and queue completion 4.7 / 6.5 ms.
- Export browser timings on the final deterministic run were SDR JPEG 39.506 ms, PNG 7.670 ms, SDR JPEG XL 96.110 ms, and JPEG Ultra HDR 555.281 ms, including Ultra HDR metadata validation.

The release is locally qualified but not globally approved until the Windows external-display and both macOS physical-display gates are recorded. The licensed representative-photo fixture is also still required for the visual Golden release baseline.
