# Module PRD: Import and RAW

- **Owner:** Steve
- **Master PRD:** [PRD](../PRD.md)
- **Last status check:** October 18, 2026, against the code.
- **Code:** `loader.py`, `raw_import.py`, `linear_dng.py`, `dng_color.py`,
  `dng_opcodes.py`, `gainmap_decoders.py`, `jpegxl.py`, `avif_info.py`,
  `metadata.py`, `import_jobs.py`, `media_browser.py`, `resource_preflight.py`,
  `sessions.py` (starting adjustments), `analysis.py`.

## 1. Purpose

Open any supported photo correctly. Bring it into the ACEScg scene-linear
working space with its colour, brightness and HDR headroom intact, and give
Grade a sensible starting point that roughly agrees with what the camera
showed.

## 2. Scope

- Input formats and their interpretation, including gain-map files.
- Camera RAW and DNG development: demosaic, white balance, camera colour,
  highlight reconstruction, lens corrections (Lensfun).
- The starting look of a newly opened photo, shared by Grade and the
  Library.
- The media browser and its Locations list.

## 3. Supported inputs

| Kind | Formats |
| --- | --- |
| Scene-linear HDR | OpenEXR, 32-bit TIFF, Radiance HDR, PFM |
| Encoded HDR | 16-bit PQ/HLG TIFF, HEIC/HEIF with gain map, AVIF (plain, PQ/HLG, gain map), JPEG Ultra HDR, JPEG XL |
| Camera RAW | `.arw .cr2 .cr3 .nef .nrw .raf .rw2 .orf .ori .pef .srw`, mosaiced DNG |
| Linear DNG | Rendered linear DNG (for example DxO PhotoLab, Adobe) |
| SDR | Plain JPEG, PNG, TIFF |

Rules in force:

- Gain-map files are never reduced to their SDR base, decoded twice, or
  tone-mapped twice. The SDR base is kept as an authored rendition.
- Malformed or unsupported HDR metadata is rejected, not silently shown as
  SDR.
- A 16-bit TIFF without a PQ/HLG transfer is treated as SDR, with a note.
- Files HDR Finisher exports are priority import cases; round trips are
  accepted within explicit tolerances, not pixel identity.

## 4. Decisions

| Decision | Date |
| --- | --- |
| Camera RAW uses a camera-linear bridge: LibRaw unpack and AHD demosaic, unity white balance through 16-bit, then float32 white balance and camera RGB to ACEScg. Opposed-colour highlight reconstruction removes magenta clipping. | 2026-09-03 |
| **Exposure starts at zero.** RAW development is tuned so that the camera JPEG, the RAW as first shown, and Grade's starting point roughly agree. The Library's starting look must match Grade's. Every RAW grade saved before the change will look brighter or darker; no migration. The strict testing rule applies (RAW import). | Steve, 2026-10-11 |
| Generic, not tuned to one camera. | 2026-10-09 |
| A RAW's starting brightness follows how it was shot, like the camera JPEG. No per-photo automatic meter, visible or hidden. Brief: [codex-brief-raw-starting-exposure-zero](../../technical/briefs/codex-brief-raw-starting-exposure-zero-2026-10-18.md). | Steve, 2026-10-18 |

## 5. Current state (October 18, 2026)

**Built:** all inputs above, the camera-linear RAW bridge with highlight
reconstruction, linear DNG import, Lensfun corrections, HEIC/AVIF/Ultra HDR
gain-map decoding, metadata panel, import progress and cancel.

**Not built**

- **Exposure at zero.** On import a RAW still gets the metered
  `recommended_exposure_ev` (`sessions.py`, starting adjustments). The
  Library's `default_look` (`library_pictures.py`) uses the metered value
  plus 0.25 EV, which may not match Grade.
- RAW tuning so the camera JPEG, the first RAW view and Grade's start
  agree.
- Linux: mounted drives (`/media`, `/run/media`, `/mnt`) are not listed
  under Locations (`media_browser.py`).
- A TIFF with an unrecognised colour profile falls back to a default that
  can mislead.
- The DNG information note still says "experimental".

## 6. Open work, in order

1. **Starting exposure at zero and RAW tuning, with Library and Grade
   matching.** Priority 3 in the master PRD. Strict testing (RAW import).
   Name the affected projects (including test projects) when it lands.
2. Linux mounted drives in Locations.
3. Unrecognised TIFF colour profiles: ask, or say clearly what was assumed.
4. Source workflow checks (Photoshop EXR, GIMP, Adobe and DxO linear DNG)
   as documentation and test work.

## 7. Detail and history

- RAW bridge: [Camera_Linear_RAW_Import_Bridge_Sprint_PRD](../archive/Camera_Linear_RAW_Import_Bridge_Sprint_PRD_2026-09-03.md)
- Linear DNG: [Linear_DNG_Import_Sprint_PRD](../archive/Linear_DNG_Import_Sprint_PRD.md)
- Original input scope and round-trip principle:
  [HDR_Finisher_PRD_v1.2 sections 4 and 13](../archive/HDR_Finisher_PRD_v1.2.md)
- Starting exposure decision: [Photo_Library_PRD section 4, October 11](../archive/Photo_Library_PRD_2026-10-09.md)
- User guide: [import](../../user-guide/import.md); workflows:
  [source preparation](../../workflows/source-preparation.md)
