import asyncio
from types import SimpleNamespace

from fastapi import HTTPException
import numpy as np
import pytest

from hdr_finisher import main
from hdr_finisher.models import AdjustmentState, GeometryAdjustments, PreviewKind
from hdr_finisher.render_cache import SessionRenderCache, encode_rgba_proxy
from hdr_finisher.resource_preflight import (
    FULL_PREVIEW_FIXED_OVERHEAD_BYTES,
    GIB,
    ResourceSnapshot,
    estimate_native_source_stream_resources,
    estimate_preview_resources,
)


def test_resident_native_stream_charges_transport_not_a_second_full_grade():
    request = dict(width=7968, height=5320, max_dimension=7968,
                   resources=ResourceSnapshot(8 * GIB, 3 * GIB, "test"))
    full = estimate_preview_resources(**request)
    streamed = estimate_native_source_stream_resources(**request, chunk_bytes=main.PROXY_STREAM_CHUNK_BYTES)
    assert not full.allowed
    assert streamed.allowed
    assert streamed.estimated_peak_bytes == FULL_PREVIEW_FIXED_OVERHEAD_BYTES + 2 * main.PROXY_STREAM_CHUNK_BYTES
    assert full.safely_available_bytes == streamed.safely_available_bytes == GIB


def test_native_stream_keeps_the_reserve_and_dimension_guards():
    working = FULL_PREVIEW_FIXED_OVERHEAD_BYTES + 2 * main.PROXY_STREAM_CHUNK_BYTES
    request = dict(width=7968, height=5320, max_dimension=7968,
                   chunk_bytes=main.PROXY_STREAM_CHUNK_BYTES)
    refused = estimate_native_source_stream_resources(
        **request, resources=ResourceSnapshot(8 * GIB, 2 * GIB + working - 1, "test"))
    assert not refused.allowed
    admitted = estimate_native_source_stream_resources(
        **request, resources=ResourceSnapshot(8 * GIB, 2 * GIB + working, "test"))
    assert admitted.allowed
    oversized = estimate_native_source_stream_resources(
        **dict(request, width=20000, max_dimension=20000),
        resources=ResourceSnapshot(8 * GIB, 8 * GIB, "test"))
    assert not oversized.allowed


@pytest.mark.parametrize("kind,authored", [(PreviewKind.HDR, False), (PreviewKind.SDR, False), (PreviewKind.SDR, True)])
def test_native_stream_borrows_the_exact_existing_lane(kind, authored):
    image = np.linspace(-0.1, 4, 8 * 5000 * 3, dtype=np.float32).reshape(8, 5000, 3)
    reference = image * np.float32(0.5) if authored else None
    cache = SessionRenderCache(image, reference)
    adjustments = AdjustmentState()
    adjustments.sdr.use_authored_base = authored
    native, space, signature = cache.native_source_stream(kind, 5000, adjustments)
    expected, expected_space, expected_signature = cache.geometry_source_proxy(kind, 5000, adjustments)
    assert native is (reference if authored else image)
    assert native is expected
    assert (space, signature) == (expected_space, expected_signature)
    assert encode_rgba_proxy(native) == encode_rgba_proxy(expected)


@pytest.mark.parametrize("geometry", [
    {"rotation": 90}, {"flip_horizontal": True}, {"flip_vertical": True},
    {"straighten_angle": 2}, {"perspective_rotate": 2},
    {"perspective_horizontal": 0.1}, {"perspective_vertical": 0.1},
    {"crop": {"x": 0.1, "y": 0, "width": 0.9, "height": 1}},
])
def test_transforming_a_source_cannot_use_the_borrowed_stream_estimate(geometry):
    cache = SessionRenderCache(np.zeros((8, 5000, 3), np.float32), None)
    adjustments = AdjustmentState()
    adjustments.shared.geometry = GeometryAdjustments(**geometry)
    assert cache.native_source_stream(PreviewKind.HDR, 5000, adjustments) is None


def test_downsampling_and_dtype_conversion_cannot_use_the_borrowed_stream_estimate():
    adjustments = AdjustmentState()
    cache = SessionRenderCache(np.zeros((8, 5000, 3), np.float32), None)
    assert cache.native_source_stream(PreviewKind.HDR, 4096, adjustments) is None
    cache = SessionRenderCache(np.zeros((8, 5000, 3), np.float64), None)
    assert cache.native_source_stream(PreviewKind.HDR, 5000, adjustments) is None


def test_stream_endpoint_preserves_bytes_and_refuses_before_encoding(monkeypatch):
    image = np.linspace(-0.1, 4, 8 * 5000 * 3, dtype=np.float32).reshape(8, 5000, 3)
    session = SimpleNamespace(image=image, edit_revision=0, adjustments=AdjustmentState(),
                              render_cache=SessionRenderCache(image, None))
    monkeypatch.setattr(main.store, "get", lambda identity: session)
    working = FULL_PREVIEW_FIXED_OVERHEAD_BYTES + 2 * main.PROXY_STREAM_CHUNK_BYTES
    monkeypatch.setattr(main, "detect_memory_resources", lambda: ResourceSnapshot(8 * GIB, 2 * GIB + working, "test"))

    def stream():
        return main.webgpu_proxy_stream("native-test", PreviewKind.HDR, long_edge=5000,
            format="rgba16f", edit_revision=0, geometry_signature=None, perspective_draft_base=False)

    response = stream()

    async def body():
        return b"".join([chunk async for chunk in response.body_iterator])

    assert asyncio.run(body()) == encode_rgba_proxy(image)[0]
    assert response.headers["X-Source-Level-State"] == "native"
    monkeypatch.setattr(main, "detect_memory_resources", lambda: ResourceSnapshot(8 * GIB, 2 * GIB + working - 1, "test"))
    with pytest.raises(HTTPException) as refused:
        stream()
    assert refused.value.status_code == 507


def test_transformed_stream_keeps_the_full_host_preflight(monkeypatch):
    image = np.zeros((8, 5000, 3), np.float32)
    adjustments = AdjustmentState()
    adjustments.shared.geometry.straighten_angle = 2
    session = SimpleNamespace(image=image, source=SimpleNamespace(width=5000, height=8),
        edit_revision=0, adjustments=adjustments, render_cache=SessionRenderCache(image, None))
    monkeypatch.setattr(main.store, "get", lambda identity: session)
    monkeypatch.setattr(main, "detect_memory_resources", lambda: ResourceSnapshot(8 * GIB, 2 * GIB, "test"))
    with pytest.raises(HTTPException) as refused:
        main.webgpu_proxy_stream("transformed-test", PreviewKind.HDR, long_edge=5000,
            format="rgba16f", edit_revision=0, geometry_signature=None, perspective_draft_base=False)
    assert refused.value.status_code == 507
