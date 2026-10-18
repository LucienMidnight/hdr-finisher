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
| **Nothing that shapes the look is baked into import.** No starting tone curve, hidden or pre-set in Curves: Film Look applies its own curves, and renders and passes must start neutral too. RAW gets one fixed brightness calibration for all cameras plus brightness information the file records (such as DNG `BaselineExposure`). Contrast comes from visible tools; the start may look flatter than the camera JPEG. Brightness against the camera JPEG is judged by eye, replacing the ±1/3 EV target. A camera-like start may come later as a visible Look. | Steve, 2026-10-18 |

## 5. Current state (October 18, 2026)

**Built:** all inputs above, the camera-linear RAW bridge with highlight
reconstruction, linear DNG import, Lensfun corrections, HEIC/AVIF/Ultra HDR
gain-map decoding, metadata panel, import progress and cancel.

**RAW zero-start implementation (October 18):** Steve approved a fixed
−0.8 EV linear calibration for every camera RAW. No scene meter, starting
curve, contrast preset or camera-style rendering is added. HDR and SDR
Exposure start at 0; source peak measurements follow calibrated pixels.
Grade and Library thumbnails use one starting-adjustment implementation. Non-camera
starts, including linear DNG and authored SDR, retain their existing behavior.

Fuji RAF tag `RawExposureBias` (0x9650) is read as its signed rational and
compensated by its negative in EV, including the recorded base offset.
[Darktable's documentation](https://docs.darktable.org/lua/stable/lua.scripts.manual/scripts/contrib/fujifilm_dynamic_range/)
independently confirms the meaning/sign across DR100/200/400 on X100S and
X100V. The comparison files record −1.13 EV (DSCF6495) and −2.72 EV
(DSCF4011). Missing/malformed information gets the plain calibration;
no offset is guessed from a DR mode or a single photo. DNG BaselineExposure
is applied once on mosaiced routes; linear DNG keeps its existing route.

Source mip, unedited Library and saved-grade picture versions have changed
so pictures from the old start regenerate. Exposure pastes as a plain number.
The finished-code 16-photo comparison, including DSCF4011, is at
`output/raw-start-measure/comparison.html`; camera-JPEG brightness is for
Steve's visual judgment, not an EV pass/fail threshold.

**Thumbnail decoder decision (October 18):** Steve approved Grade's decoder
and full-source measurements for unedited RAW grid/filmstrip thumbnails and
their kept pictures. These explicitly request a separate thumbnail route;
camera JPEG preview still appears first, then Grade-decoded pixels render
on the GPU and are kept. Single/fullscreen browsing retains its separate
quick RAW/GPU decoder, including its existing differences, for the speed
exploration. Saved-grade pictures already use Grade's decoder.

Cold sequential thumbnails on five badminton photos, with empty application
caches and Windows' file cache left alone: visible median 4.64 s / p90 4.78 s,
versus quick-route 0.55 s / 2.54 s; added 4.09 s / 2.25 s. Camera preview
median 34 ms; finished thumbnail kept by median 4.86 s / p90 4.93 s. No speed
optimization was attempted. The agreed perceptual limits remain SDR ΔE 2000
and HDR ΔE ITP mean <1, p99.9 ≤3; Steve's final sheet review remains open.

Finished-source validation: all 16 comparison photos pass both SDR and HDR
limits after scene-cache storage, using Grade's exact starting state. The
unchanged kept gain-map JPEG transport passes 7/16 SDR and 14/16 HDR; nine
SDR and two HDR photos exceed the limits after compression. Worst SDR
p99.9 is 3.60; worst HDR mean is 1.79 and p99.9 is 21.34. This remaining
encoding limitation is recorded; the thumbnail codec was not changed in
the decoder task. Source decoding and the kept JPEG must not be described
as equivalent validation results.

Follow-up checks: 534 Node and 2291 Python passed (3 skipped); the Electron
five-photo thumbnail routing/render/keep measurement passed. The separate
16-photo comparison passed every scene-cache result but failed the kept
JPEG results listed above. No export/Proof code or tolerances changed.

Validation at `a2263fe`: 534 Node checks passed. Full Python: 2285 passed,
3 skipped, one old RAW-gain expectation subsequently updated; all 53 focused
checks then passed. Ten slow drivers passed, including RAW import, real-RAW
preview/export agreement, GPU delivery and full-size Proof/export identity
in Ultra HDR JPEG, gain-map AVIF and HDR JPEG XL. Four UI drivers failed
(file-browser state, Proof-size browser closure, thumbnail settings timeout,
saved-picture refresh response field); thumbnail colour measurements passed.
No unrelated UI repairs were made and protected photo/project hashes stayed
unchanged. The Library agreement failure above remains open.

**Affected saved work:** 28 RAW `.hdrfinisher` projects and 56 graded RAW
`.hdrf` files were identified read-only in HDR Test Images, Play_Raw,
20261017 badminton, test-photos-delete-later and the two viewport fixtures.
The exact paths are in `output/raw-start-measure/affected-projects.json`.
They retain their saved control values and change brightness; no migration.
The Alkeria linear-DNG test project's old source path is missing; it is
outside this camera-RAW change. No source/project/sidecar was rewritten.

**Not built**

- Complete Library-to-Grade RAW picture agreement and Steve's final
  brightness review (implementation and limitation above).
- Linux: mounted drives (`/media`, `/run/media`, `/mnt`) are not listed
  under Locations (`media_browser.py`).
- A TIFF with an unrecognised colour profile falls back to a default that
  can mislead.
- The DNG information note still says "experimental".

## 6. Open work, in order

1. **Finish validation of the zero RAW start:** obtain Steve's visual review
   of the final sheet. Kept thumbnail JPEG compression still exceeds the
   agreed perceptual limits on some photos. The unchanged quick
   Single/fullscreen decoder is deferred to the speed exploration.
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
