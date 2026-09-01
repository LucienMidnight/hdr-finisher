Machine-consumed automated test fixtures live here.

Fixtures in this directory must be deterministic, small enough to commit, and directly exercised by the automated test suite. Keep human-run procedures in local maintainer QA notes, private or large photographs and working media in `codebase/local-test-media/inputs/`, and generated reports or exports in `codebase/output/`.

Current checked-in fixtures:

- `sdr_gradient.png`: small SDR bitmap for the Pillow loader path
- `hdr_headroom.tiff`: deterministic rw203-v1 float chart with exact black, near-black, 100/203/406/1000/over-range nit patches, saturated colors, and a log gradient
- `hdr_match_scene.tiff`: calibrated HDR-to-SDR match scene with neutral ramp, skin-like and saturated patches, textured midtones, a broad window, lamp, emissive strip, and isolated speculars
- `linear_unconfirmed.exr`: scene-linear EXR with no values above 1.0 for the unconfirmed HDR path
- `blender_linear_rec2020.exr`: 8 x 8 Blender 5.2 OpenEXR carrying `colorInteropID: lin_rec2020_scene`

Regenerate them with:

- `python tests\fixtures\generate_fixtures.py`

The Blender fixture is a fixed Blender-authored interoperability sample and is not rewritten by the general fixture generator. Regenerate it only with the matching Blender output-color-management path so its real EXR header is preserved.
