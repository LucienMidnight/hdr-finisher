Machine-consumed automated test fixtures live here.

Fixtures in this directory must be deterministic, small enough to commit, and directly exercised by the automated test suite. Keep human-run procedures in local maintainer QA notes, private photographs in `<photosRoot>/HDR Test Images` (identical on both machines; approved inventory in `docs/technical/test-photos.md` and hashes in `codebase/tests/test-photos.manifest.json`), and generated reports or exports in `codebase/output/`.

Current checked-in fixtures:

- Grain cancellation uses `tests/helpers/grain_before_88775059.py`, the frozen pre-cancellation implementation from `88775059`. `test_grain_work.py` compares both implementations in the same run with exact equality (both lanes/types, native/2x2/4x4 sampling and two row chunks), avoiding platform-dependent libm differences in precomputed arrays.

- `sdr_gradient.png`: small SDR bitmap for the Pillow loader path
- `library_photo.png`: 300×200 SDR gradient, above the Library's 1 KiB minimum photo size (smaller files are treated as placeholders and not listed)
- `hdr_headroom.tiff`: deterministic rw203-v1 float chart with exact black, near-black, 100/203/406/1000/over-range nit patches, saturated colors, and a log gradient
- `hdr_match_scene.tiff`: calibrated HDR-to-SDR match scene with neutral ramp, skin-like and saturated patches, textured midtones, a broad window, lamp, emissive strip, and isolated speculars
- `linear_unconfirmed.exr`: scene-linear EXR with no values above 1.0 for the unconfirmed HDR path
- `blender_linear_rec2020.exr`: 8 x 8 Blender 5.2 OpenEXR carrying `colorInteropID: lin_rec2020_scene`
- `export-speed/santorini-2026-0068-grade.json` and `export-speed/play-raw-export-preset.json`: Steve's full grade (Clean Grain, perspective and crop, Detail, Film Look with grain and halation, a brush local adjustment, Framing) and export preset (AVIF gain map, long edge 1920, frame) from the Nov 22, 2026 Windows export that took 175 s. Source path removed. The export-speed driver transplants this recipe onto a disposable copy of `_DSC7970.ARW`.

Regenerate them with:

- `python tests\fixtures\generate_fixtures.py`

The Blender fixture is a fixed Blender-authored interoperability sample and is not rewritten by the general fixture generator. Regenerate it only with the matching Blender output-color-management path so its real EXR header is preserved.
