"""A full-size Proof is the export, byte for byte.

Viewport-Bounded GPU Preview PRD, section 3: Proof is how a user checks the
real result before exporting, so at full size it has to *be* the export
pipeline rather than a picture of it. Section 4.5 lists the same equality among
the things that stay bit-exact when the interactive preview is allowed to
approximate.

These tests run the real encoders and are skipped where one is not installed.
The frame is larger than the 1,600 px a reduced proof may ask for, so a pass
cannot come from a reduced proof that happened to be native size. The grade
carries the four mask kinds of the reference case (linear gradient, luminance
range, path, brush), each with an exposure adjustment.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from hdr_finisher.capabilities import probe_capabilities
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.exporters import build_export_backends
from hdr_finisher.models import (
    AdjustmentState,
    BrushStroke,
    CapabilityStatus,
    ExportSettings,
    LocalAdjustment,
    LocalGrade,
    MaskExpression,
    MaskLeaf,
    MaskPoint,
    PathNode,
    ProofArtifactRequest,
)
from hdr_finisher.proofing import ProofArtifactStore
from hdr_finisher.render_cache import SessionRenderCache

WIDTH = 2000
HEIGHT = 1300
FORMATS = {
    "jpeg_ultrahdr": ("ultrahdr_encoder", ".jpg"),
    "avif_gain_map": ("avif_gain_map_encoder", ".avif"),
    "jpegxl_hdr": ("jpegxl_export", ".jxl"),
}


def _source() -> np.ndarray:
    """Scene-linear ACEScg with a ramp, noise, a specular and a deep shadow."""
    generator = np.random.default_rng(20261001)
    y, x = np.mgrid[0:HEIGHT, 0:WIDTH].astype(np.float32)
    ramp = (x / WIDTH) * 2.0 + 0.02
    image = np.stack([ramp, ramp * (0.6 + 0.4 * y / HEIGHT), ramp * 0.8], axis=-1)
    image += generator.normal(0.0, 0.01, image.shape).astype(np.float32)
    image[120:170, 260:340] = 24.0
    image[800:1200, 1200:1700] *= 0.05
    return np.clip(image, 0.0, None).astype(np.float32)


def _local(name: str, leaf: MaskLeaf, exposure: float) -> LocalAdjustment:
    return LocalAdjustment(
        name=name,
        mask=MaskExpression(leaf=leaf),
        hdr_grade=LocalGrade(exposure=exposure),
        sdr_grade=LocalGrade(exposure=exposure),
    )


def _four_mask_locals() -> list[LocalAdjustment]:
    return [
        _local(
            "gradient",
            MaskLeaf(type="linear_gradient", start=MaskPoint(x=0.5, y=0.05), end=MaskPoint(x=0.5, y=0.6)),
            -0.7,
        ),
        _local(
            "luminance",
            MaskLeaf(
                type="luminance_range",
                fade_in_start_ev=0.5,
                full_start_ev=1.5,
                full_end_ev=6.0,
                fade_out_end_ev=10.0,
                mask_feather=0.01,
            ),
            -0.5,
        ),
        _local(
            "path",
            MaskLeaf(
                type="path",
                nodes=[
                    PathNode(x=0.55, y=0.55, node_type="sharp"),
                    PathNode(x=0.9, y=0.6, node_type="sharp"),
                    PathNode(x=0.85, y=0.95, node_type="sharp"),
                    PathNode(x=0.6, y=0.9, node_type="sharp"),
                ],
                feather_softness=0.5,
            ),
            1.0,
        ),
        _local(
            "brush",
            MaskLeaf(
                type="brush",
                strokes=[
                    BrushStroke(
                        points=[MaskPoint(x=0.15, y=0.7, pressure=0.8), MaskPoint(x=0.4, y=0.8), MaskPoint(x=0.3, y=0.4)],
                        radius=0.04,
                        hardness=0.5,
                    )
                ],
                mask_feather=0.01,
            ),
            0.8,
        ),
    ]


def _session(image: np.ndarray) -> SimpleNamespace:
    context = RenderColorContext(203)
    adjustments = AdjustmentState()
    adjustments.hdr.exposure = 0.4
    adjustments.sdr.exposure = 0.2
    return SimpleNamespace(
        session_id="proof-export-identity",
        image=image,
        sdr_reference_image=None,
        adjustments=adjustments,
        hdr_reference_white_nits=context.hdr_reference_white_nits,
        color_context=context,
        local_adjustments=_four_mask_locals(),
        sdr_match=None,
        denoise=None,
        render_cache=SessionRenderCache(image, None, color_context=context),
    )


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module")
def backends():
    capabilities = probe_capabilities()
    return capabilities, build_export_backends(capabilities)


@pytest.mark.parametrize("format_name", sorted(FORMATS))
def test_full_size_proof_is_the_export_byte_for_byte(backends, tmp_path: Path, format_name: str) -> None:
    capabilities, export_backends = backends
    capability, suffix = FORMATS[format_name]
    if capabilities[capability].status != CapabilityStatus.AVAILABLE:
        pytest.skip(f"{capability} is not available: {capabilities[capability].detail}")
    backend = export_backends[format_name]
    session = _session(_source())

    hashes = []
    for run in (1, 2):
        result = backend.export(
            session,
            ExportSettings(format=format_name, output_path=str(tmp_path / f"export-{run}{suffix}"), overwrite=True),
        )
        assert result.accepted, result.message
        hashes.append(_sha(Path(result.output_path)))
    # Section 4.5: the same project and settings exported twice is one file.
    assert hashes[0] == hashes[1]

    store = ProofArtifactStore()
    try:
        # The export above ran on ExportSettings defaults; a proof request
        # defaults to a higher quality, so the shared encoding field is named.
        proof = store.create(
            session,
            ProofArtifactRequest(
                adjustments=session.adjustments,
                format=format_name,
                quality=ExportSettings().quality,
                full_size=True,
            ),
            backend,
        )
        assert proof.full_size is True
        assert (proof.width, proof.height) == (WIDTH, HEIGHT)
        assert proof.sha256 == hashes[0]

        reduced = store.create(
            session,
            ProofArtifactRequest(
                adjustments=session.adjustments,
                format=format_name,
                quality=ExportSettings().quality,
                long_edge=1200,
            ),
            backend,
        )
        assert reduced.full_size is False
        assert max(reduced.width, reduced.height) == 1200
        assert reduced.artifact_id != proof.artifact_id
    finally:
        store.clear()


def test_reduced_proof_of_a_small_frame_reports_full_size() -> None:
    """A frame no larger than the reduced edge is not downscaled, so not labelled reduced."""

    class _Backend:
        name = "fake"

        def export(self, session: object, settings: ExportSettings):
            from hdr_finisher.models import ExportResponse

            Path(settings.output_path).write_bytes(b"proof")
            return ExportResponse(accepted=True, backend="fake", message="ok", output_path=settings.output_path)

    import hdr_finisher.proofing as proofing_module

    image = np.full((12, 16, 3), 0.18, dtype=np.float32)
    session = SimpleNamespace(session_id="small", render_cache=SessionRenderCache(image, None))
    store = ProofArtifactStore()
    original_inspect = proofing_module._inspect_artifact
    original_render = proofing_module._render_export_branch
    proofing_module._inspect_artifact = lambda *_args: (3.0, "test metadata")
    proofing_module._render_export_branch = lambda *_args, **_kwargs: image
    try:
        response = store.create(
            session,
            ProofArtifactRequest(adjustments=AdjustmentState(), format="jpeg_ultrahdr", long_edge=256),
            _Backend(),
        )
    finally:
        proofing_module._inspect_artifact = original_inspect
        proofing_module._render_export_branch = original_render
        store.clear()
    assert response.full_size is True


def test_full_size_is_part_of_the_proof_request_signature() -> None:
    """A reduced proof must never be served from the cache for a full-size request."""
    context = RenderColorContext()
    reduced = ProofArtifactRequest(adjustments=AdjustmentState(), format="jpeg_ultrahdr")
    full = ProofArtifactRequest(adjustments=AdjustmentState(), format="jpeg_ultrahdr", full_size=True)
    assert ProofArtifactStore._request_signature("session", reduced, context) != ProofArtifactStore._request_signature(
        "session", full, context
    )
