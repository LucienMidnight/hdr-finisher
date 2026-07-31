from __future__ import annotations

from io import BytesIO

import numpy as np
from PIL import Image

from hdr_finisher.color import acescg_to_linear_srgb
from hdr_finisher.models import AdjustmentState, PreviewKind, PreviewRequest
from hdr_finisher.preview import encode_processed_preview_bytes


def test_preview_request_defaults_to_hdr_transport_for_existing_clients() -> None:
    request = PreviewRequest(adjustments=AdjustmentState())

    assert request.hdr_display is True


def test_hdr_sdr_display_preview_matches_webgpu_fallback_math() -> None:
    processed = np.array(
        [
            [[0.01, 0.02, 0.04], [0.18, 0.18, 0.18]],
            [[1.0, 0.4, 0.1], [4.0, 2.0, 0.5]],
        ],
        dtype=np.float32,
    )

    body, media_type = encode_processed_preview_bytes(
        processed,
        PreviewKind.HDR,
        hdr_display=False,
    )

    decoded = np.asarray(Image.open(BytesIO(body)), dtype=np.float32) / 255.0
    linear = np.clip(acescg_to_linear_srgb(processed), 0.0, None)
    display = linear / (1.0 + linear)
    expected = np.where(
        display <= 0.0031308,
        display * 12.92,
        1.055 * np.power(np.clip(display, 0.0, 1.0), 1.0 / 2.4) - 0.055,
    )

    assert media_type == "image/png"
    np.testing.assert_allclose(decoded, expected, atol=(1.5 / 255.0), rtol=0.0)


def test_sdr_display_fallback_is_finite_for_extended_hdr_values() -> None:
    values = np.geomspace(1e-8, 10000.0, 64, dtype=np.float32)
    processed = np.repeat(values.reshape(1, -1, 1), 3, axis=2)

    body, media_type = encode_processed_preview_bytes(
        processed,
        PreviewKind.HDR,
        hdr_display=False,
    )
    decoded = np.asarray(Image.open(BytesIO(body)))

    assert media_type == "image/png"
    assert np.all(np.isfinite(decoded))
    assert np.all(np.diff(decoded[0, :, 0].astype(np.int16)) >= 0)
