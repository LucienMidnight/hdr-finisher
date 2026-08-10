# HDR Finisher Alpha Manual QA Checklist

Use this checklist after `tools\run_alpha_qa.ps1` and `tools\build_windows.ps1` pass.

## Packaged Alpha
- Unzip `codebase\output\package\HDR-Finisher-v*-Windows-x64.zip` on a Windows machine without Python or the source checkout.
- Run **HDR Finisher.exe** from the extracted folder root and confirm the browser launcher displays the expected application version.
- Confirm the launcher and application work at the displayed `http://127.0.0.1:<port>` address in Edge or Brave.
- Repeat with port 8000 occupied and confirm HDR Finisher selects another local port instead of failing.
- Confirm `/health` returns `{"status":"ok"}`.
- Confirm capabilities show AVIF gain-map export available, JPEG Ultra HDR available when the pinned encoder is bundled, and JPEG XL deferred.
- Import the bundled/sample HDR reference workflow and export AVIF + gain map.
- Inspect the exported AVIF with `avifdec --info` and confirm gain map metadata is present.
- Export `JPEG Ultra HDR (JPG + Gain Map)` and confirm the output uses the selected folder, filename, `.jpg` extension, base quality, gain-map quality, and gain-map resolution.
- Confirm Browse opens the native Windows folder picker, supports a path containing spaces, and reports cancellation without an error.
- Run `ultrahdr_app -m 1 -j <export.jpg> -P` and confirm gain-map metadata is reported.

## HDR And SDR Displays
- On the HDR monitor, confirm HDR preview is visibly brighter than SDR fallback for highlight test content.
- Move the same browser window to the SDR monitor and confirm the UI remains usable and the SDR fallback view is display-safe.
- Treat Playwright screenshots as UI/layout evidence only; they are not proof of HDR presentation.

## iPhone HEIC Workflow
- Load a local iPhone HDR `.heic`.
- Confirm the analyzer reports Apple HDR gain-map application when auxiliary data is present.
- Confirm `sdr_reference_present` is true when using `tools\local_media_probe.py`.
- Compare HDR preview, SDR fallback, false color, zebra overlay, and exported AVIF in Edge/Brave.

## EXR Workflows
- Test one Sony RAW-derived EXR.
- Test one Blender-rendered EXR.
- Confirm source interpretation, manual override behavior, waveform shape, false color/zebra behavior, and exported AVIF gain-map metadata.

## JPEG Ultra HDR / Instagram / Browser
- Follow [JPEG Ultra HDR Reliability](JPEG_Ultra_HDR_Reliability.md) for the separate edge-fidelity and matrix-color checks using the iPhone and Blender fixtures.
- On an HDR monitor with Windows HDR enabled, open the exported `.jpg` in an Ultra HDR-capable Edge/Brave workflow and confirm highlights exceed the SDR rendition without unexpected hue shifts.
- Move the same window to an SDR monitor and confirm the authored SDR fallback remains display-safe and visually intentional.
- Open the `.jpg` with a legacy JPEG-only decoder and confirm it displays normally with no corruption or dependency on the gain map.
- Upload the `.jpg` to a private/test Instagram post from a supported mobile workflow. Confirm Instagram preserves HDR on a supported HDR phone and presents the authored SDR fallback elsewhere.
- Download the Instagram-served result when practical and re-probe it with `ultrahdr_app`; record whether gain-map metadata survived platform recompression.
- Confirm `cjxl` / `djxl` remain capability-gated; JPEG XL is not part of this milestone.
