Synthetic and real HDR fixture files live here.

Current checked-in fixtures:
- `sdr_gradient.png`: small SDR bitmap for the Pillow loader path
- `hdr_headroom.tiff`: float TIFF with values above 1.0 for true HDR classification
- `linear_unconfirmed.exr`: scene-linear EXR with no values above 1.0 for the unconfirmed HDR path

Regenerate them with:
- `python tests\fixtures\generate_fixtures.py`
