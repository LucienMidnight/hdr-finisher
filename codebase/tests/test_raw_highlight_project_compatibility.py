from __future__ import annotations

from hdr_finisher.models import RawImportSettings


def test_new_raw_recipes_default_opposed_color_reconstruction_on() -> None:
    settings = RawImportSettings()

    assert settings.highlight_reconstruction.enabled is True
    assert settings.highlight_reconstruction.method == "opposed_color_v1"
    assert settings.highlight_reconstruction.clipping_threshold == 1.0
