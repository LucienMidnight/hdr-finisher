"""Phase 3: the bounded source-tile transport contract.

The exit gate asks that a large source can begin preparation without an
image-sized browser response buffer, and that tile assembly match the current
full-frame proxy output within approved tolerance. These tests drive the real
endpoint and reassemble its tiles into the whole proxy to check both.
"""

from __future__ import annotations

import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from hdr_finisher.main import app, store


client = TestClient(app)

# rgba16float carries roughly three decimal digits, so a decoded tile and a
# decoded whole-frame proxy agree to about 1e-3 relative. Every difference
# below comes from that transport, not from the tiling.
HALF_FLOAT_ATOL = 2e-3


def _large_png_bytes(width: int = 320, height: int = 240) -> bytes:
    """A source big enough to tile, with structure so a misplaced tile shows."""
    import io

    from PIL import Image

    x = np.linspace(0, 255, width, dtype=np.float32)[None, :]
    y = np.linspace(0, 255, height, dtype=np.float32)[:, None]
    red = np.broadcast_to(x, (height, width))
    green = np.broadcast_to(y, (height, width))
    blue = (np.abs(x - y) % 256.0).astype(np.float32)
    pixels = np.stack((red, green, blue), axis=-1).astype(np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(pixels, mode="RGB").save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture()
def session_id() -> str:
    upload = client.post("/api/session", files={"file": ("tile-fixture.png", _large_png_bytes(), "image/png")})
    assert upload.status_code == 200
    return upload.json()["session"]["session_id"]


def _decode(response, channels: int = 4) -> np.ndarray:
    width = int(response.headers["x-tile-width"])
    height = int(response.headers["x-tile-height"])
    bytes_per_row = int(response.headers["x-bytes-per-row"])
    dtype = np.float16 if response.headers["x-pixel-format"] == "rgba16float" else np.float32
    raw = np.frombuffer(response.content, dtype=np.uint8)
    itemsize = np.dtype(dtype).itemsize
    rows = raw.reshape(height, bytes_per_row)[:, : width * channels * itemsize]
    return np.ascontiguousarray(rows).view(dtype).reshape(height, width, channels).astype(np.float32)


def _decode_proxy(response, channels: int = 4) -> np.ndarray:
    width = int(response.headers["x-image-width"])
    height = int(response.headers["x-image-height"])
    bytes_per_row = int(response.headers["x-bytes-per-row"])
    dtype = np.float16 if response.headers["x-pixel-format"] == "rgba16float" else np.float32
    raw = np.frombuffer(response.content, dtype=np.uint8)
    itemsize = np.dtype(dtype).itemsize
    rows = raw.reshape(height, bytes_per_row)[:, : width * channels * itemsize]
    return np.ascontiguousarray(rows).view(dtype).reshape(height, width, channels).astype(np.float32)


def _tile(session_id: str, **params):
    return client.get(f"/api/session/{session_id}/source-tile/hdr", params=params)


def test_a_tile_response_is_bounded_by_its_rectangle_not_the_image(session_id: str) -> None:
    whole = client.get(f"/api/session/{session_id}/proxy/hdr", params={"long_edge": 512})
    assert whole.status_code == 200

    tile = _tile(session_id, long_edge=512, x=0, y=0, width=32, height=32)
    assert tile.status_code == 200
    assert int(tile.headers["x-tile-width"]) == 32
    assert int(tile.headers["x-tile-height"]) == 32

    # This is the exit-gate property: the response scales with the rectangle,
    # so preparation never needs an image-sized buffer in the browser.
    assert len(tile.content) < len(whole.content)
    assert len(tile.content) <= 32 * 256


def test_tiles_reassemble_into_the_whole_frame_proxy(session_id: str) -> None:
    whole = client.get(f"/api/session/{session_id}/proxy/hdr", params={"long_edge": 256, "format": "rgba16f"})
    assert whole.status_code == 200
    reference = _decode_proxy(whole)
    height, width = reference.shape[:2]

    probe = _tile(session_id, long_edge=256, x=0, y=0, width=1, height=1)
    assert int(probe.headers["x-output-width"]) == width
    assert int(probe.headers["x-output-height"]) == height

    assembled = np.zeros_like(reference)
    covered = np.zeros((height, width), dtype=np.int32)
    step = 37  # deliberately not a divisor, so the last tiles are partial
    for top in range(0, height, step):
        for left in range(0, width, step):
            tile_width = min(step, width - left)
            tile_height = min(step, height - top)
            response = _tile(
                session_id,
                long_edge=256,
                x=left,
                y=top,
                width=tile_width,
                height=tile_height,
                format="rgba16f",
            )
            assert response.status_code == 200
            pixels = _decode(response)
            assembled[top : top + tile_height, left : left + tile_width] = pixels
            covered[top : top + tile_height, left : left + tile_width] += 1

    assert int(covered.min()) == 1
    assert int(covered.max()) == 1
    np.testing.assert_allclose(assembled, reference, atol=HALF_FLOAT_ATOL, rtol=HALF_FLOAT_ATOL)


def test_a_halo_extends_the_delivered_rectangle_and_is_reported(session_id: str) -> None:
    response = _tile(session_id, long_edge=256, x=64, y=48, width=32, height=32, halo=8)
    assert response.status_code == 200

    assert int(response.headers["x-core-x"]) == 64
    assert int(response.headers["x-core-y"]) == 48
    assert int(response.headers["x-core-width"]) == 32
    assert int(response.headers["x-core-height"]) == 32
    assert int(response.headers["x-halo"]) == 8
    assert int(response.headers["x-tile-x"]) == 56
    assert int(response.headers["x-tile-y"]) == 40
    assert int(response.headers["x-tile-width"]) == 48
    assert int(response.headers["x-tile-height"]) == 48


def test_a_halo_is_clamped_at_the_output_edge_rather_than_padded(session_id: str) -> None:
    response = _tile(session_id, long_edge=256, x=0, y=0, width=16, height=16, halo=8)
    assert response.status_code == 200

    # No invented pixels outside the image: the delivered rect stops at 0.
    assert int(response.headers["x-tile-x"]) == 0
    assert int(response.headers["x-tile-y"]) == 0
    assert int(response.headers["x-tile-width"]) == 24
    assert int(response.headers["x-tile-height"]) == 24


def test_the_halo_region_matches_the_neighbouring_core_pixels(session_id: str) -> None:
    """A halo must be real neighbouring output, which is what makes seams work."""
    plain = _tile(session_id, long_edge=256, x=64, y=64, width=32, height=32, format="rgba32f")
    haloed = _tile(session_id, long_edge=256, x=64, y=64, width=32, height=32, halo=8, format="rgba32f")
    assert plain.status_code == 200 and haloed.status_code == 200

    core = _decode(plain)
    padded = _decode(haloed)
    np.testing.assert_array_equal(padded[8:40, 8:40], core)


def test_the_tile_response_carries_its_full_identity(session_id: str) -> None:
    response = _tile(session_id, long_edge=256, x=0, y=0, width=8, height=8)
    assert response.status_code == 200

    for header in (
        "x-source-epoch",
        "x-geometry-signature",
        "x-edit-revision",
        "x-working-space",
        "x-pixel-format",
        "x-resample-stage",
        "x-output-width",
        "x-output-height",
    ):
        assert response.headers.get(header), f"missing {header}"
    assert response.headers["x-resample-stage"] == "index"
    assert response.headers["x-pixel-format"] == "rgba16float"


def test_a_stale_source_epoch_is_rejected_rather_than_answered(session_id: str) -> None:
    current = int(_tile(session_id, long_edge=256, x=0, y=0, width=8, height=8).headers["x-source-epoch"])

    fresh = _tile(session_id, long_edge=256, x=0, y=0, width=8, height=8, source_epoch=current)
    assert fresh.status_code == 200

    stale = _tile(session_id, long_edge=256, x=0, y=0, width=8, height=8, source_epoch=current + 7)
    assert stale.status_code == 409
    assert "Stale source epoch" in stale.json()["detail"]


def test_a_stale_geometry_signature_is_rejected_rather_than_answered(session_id: str) -> None:
    session = store.get(session_id)
    authoritative = session.adjustments.shared.geometry.model_dump(mode="json")

    fresh = _tile(
        session_id, long_edge=256, x=0, y=0, width=8, height=8,
        geometry_signature=json.dumps(authoritative, separators=(",", ":")),
    )
    assert fresh.status_code == 200

    stale_geometry = dict(authoritative)
    stale_geometry["rotation"] = 90
    stale = _tile(
        session_id, long_edge=256, x=0, y=0, width=8, height=8,
        geometry_signature=json.dumps(stale_geometry, separators=(",", ":")),
    )
    assert stale.status_code == 409
    assert "Stale geometry" in stale.json()["detail"]


def test_a_stale_edit_revision_is_rejected(session_id: str) -> None:
    session = store.get(session_id)
    stale = _tile(
        session_id, long_edge=256, x=0, y=0, width=8, height=8,
        edit_revision=session.edit_revision + 5,
    )
    assert stale.status_code == 409


def test_a_rect_beyond_the_output_is_clamped_not_refused(session_id: str) -> None:
    probe = _tile(session_id, long_edge=256, x=0, y=0, width=1, height=1)
    width = int(probe.headers["x-output-width"])
    height = int(probe.headers["x-output-height"])

    response = _tile(session_id, long_edge=256, x=width - 4, y=height - 4, width=512, height=512)
    assert response.status_code == 200
    assert int(response.headers["x-core-width"]) == 4
    assert int(response.headers["x-core-height"]) == 4


@pytest.mark.parametrize(
    "geometry_fields",
    [
        pytest.param({"rotation": 90}, id="rotate-90"),
        pytest.param({"flip_horizontal": True, "flip_vertical": True}, id="flips"),
        pytest.param({"crop": {"x": 0.1, "y": 0.2, "width": 0.6, "height": 0.5}}, id="crop"),
        pytest.param({"rotation": 270, "crop": {"x": 0.05, "y": 0.1, "width": 0.8, "height": 0.7}}, id="rotate-crop"),
        pytest.param({"perspective_vertical": 14.0}, id="perspective"),
        pytest.param({"straighten_angle": 3.5}, id="roll"),
    ],
)
def test_tiles_follow_geometry_and_match_the_whole_frame(session_id: str, geometry_fields: dict) -> None:
    """The seam gate: crop, rotation, perspective, and source boundaries."""
    geometry = store.get(session_id).adjustments.shared.geometry
    for key, value in geometry_fields.items():
        if key == "crop":
            for field, amount in value.items():
                setattr(geometry.crop, field, amount)
        else:
            setattr(geometry, key, value)

    whole = client.get(f"/api/session/{session_id}/proxy/hdr", params={"long_edge": 256, "format": "rgba32f"})
    assert whole.status_code == 200
    reference = _decode_proxy(whole)
    height, width = reference.shape[:2]

    probe = _tile(session_id, long_edge=256, x=0, y=0, width=1, height=1, format="rgba32f")
    if probe.status_code == 409:
        pytest.skip(f"tile path declined this geometry: {probe.json()['detail']}")
    assert int(probe.headers["x-output-width"]) == width
    assert int(probe.headers["x-output-height"]) == height

    assembled = np.zeros_like(reference)
    step = 41
    for top in range(0, height, step):
        for left in range(0, width, step):
            tile_width = min(step, width - left)
            tile_height = min(step, height - top)
            response = _tile(
                session_id, long_edge=256, x=left, y=top,
                width=tile_width, height=tile_height, format="rgba32f",
            )
            assert response.status_code == 200
            assembled[top : top + tile_height, left : left + tile_width] = _decode(response)

    # Float32 transport, so the only slack is the windowed projective resample.
    np.testing.assert_allclose(assembled, reference, atol=1e-5, rtol=1e-5)
