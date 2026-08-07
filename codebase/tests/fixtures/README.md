Machine-consumed automated test fixtures live here.

Fixtures in this directory must be deterministic, small enough to commit, and directly exercised by the automated test suite. Human-run procedures belong in `docs/testing/`, private or large photographs and working media belong in `codebase/local-test-media/inputs/`, and generated reports or exports belong in `codebase/output/`.

Current checked-in fixtures:

- `sdr_gradient.png`: small SDR bitmap for the Pillow loader path
- `hdr_headroom.tiff`: float TIFF with values above 1.0 for true HDR classification
- `linear_unconfirmed.exr`: scene-linear EXR with no values above 1.0 for the unconfirmed HDR path
- `blender_linear_rec2020.exr`: 8 x 8 Blender 5.2 OpenEXR carrying `colorInteropID: lin_rec2020_scene`

Regenerate them with:

- `python tests\fixtures\generate_fixtures.py`

The Blender fixture is a fixed Blender-authored interoperability sample and is not rewritten by the general fixture generator. Regenerate it only with the matching Blender output-color-management path so its real EXR header is preserved.
