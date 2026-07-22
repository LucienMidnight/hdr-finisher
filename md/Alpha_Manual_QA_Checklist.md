# HDR Finisher Alpha Manual QA Checklist

Use this checklist after `tools\run_alpha_qa.ps1` and `tools\build_windows.ps1` pass.

## Packaged Alpha
- Unzip `codebase\output\package\HDRFinisher-alpha-windows.zip` on a Windows machine without relying on the source checkout.
- Run `HDRFinisher.exe`.
- Open `http://127.0.0.1:8000` in Chrome, Brave, or Edge.
- Confirm `/health` returns `{"status":"ok"}`.
- Confirm capabilities show AVIF gain-map export available and JXL / Ultra HDR missing or deferred if their binaries are not bundled.
- Import the bundled/sample HDR reference workflow and export AVIF + gain map.
- Inspect the exported AVIF with `avifdec --info` and confirm gain map metadata is present.

## HDR And SDR Displays
- On the HDR monitor, confirm HDR preview is visibly brighter than SDR fallback for highlight test content.
- Move the same browser window to the SDR monitor and confirm the UI remains usable and the SDR fallback view is display-safe.
- Treat Playwright screenshots as UI/layout evidence only; they are not proof of HDR presentation.

## iPhone HEIC Workflow
- Load a local iPhone HDR `.heic`.
- Confirm the analyzer reports Apple HDR gain-map application when auxiliary data is present.
- Confirm `sdr_reference_present` is true when using `tools\local_media_probe.py`.
- Compare HDR preview, SDR fallback, false color, zebra overlay, and exported AVIF in Chrome/Brave/Edge.

## EXR Workflows
- Test one Sony RAW-derived EXR.
- Test one Blender-rendered EXR.
- Confirm source interpretation, manual override behavior, waveform shape, false color/zebra behavior, and exported AVIF gain-map metadata.

## JXL / Ultra HDR
- Confirm `cjxl`, `djxl`, and `ultrahdr_app` capability state.
- Do not treat missing JXL/UHD binaries as alpha blockers.
- Only schedule export implementation after the Windows alpha package and AVIF workflow are validated.
