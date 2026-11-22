from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, wait
from dataclasses import replace
from io import BytesIO
import math
from pathlib import Path
from threading import Event

import numpy as np
import pytest
import tifffile
from fastapi.testclient import TestClient
from PIL import Image

import hdr_finisher.proofing as proofing_module
from hdr_finisher.models import (
    AdjustmentState,
    CapabilityInfo,
    CapabilityStatus,
    DenoiseDocumentSettings,
    ExportResponse,
    ExportSettings,
    JPEGGainMapProofMetadata,
    ProofArtifactRequest,
    ProofReconstructionRequest,
)
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.delivery_frames import DeliveryFrame
from hdr_finisher.exporters import write_avif_gainmap_renditions
from hdr_finisher.proofing import (
    GainMapParameters,
    ProofArtifact,
    ProofArtifactStore,
    _inspect_jpeg_gain_map,
    apply_gain_map_formula,
    reconstruct_from_endpoints,
    target_headroom_for_peak_nits,
)
from hdr_finisher.color import linear_bt2020_to_acescg, linear_srgb_to_acescg
from hdr_finisher.render_cache import SessionRenderCache
from hdr_finisher.main import app, get_capabilities, store as session_store


client = TestClient(app)


def test_proof_store_cleans_its_directory_under_desktop_scratch(monkeypatch, tmp_path):
    monkeypatch.setenv("HDR_FINISHER_PROOF_ROOT", str(tmp_path))
    store = ProofArtifactStore()
    assert store.root.parent == tmp_path
    (store.root / "finished-frame.rgb").write_bytes(b"scratch")
    store.clear()
    assert not store.root.exists()
    assert tmp_path.is_dir()


def test_empty_desktop_proof_root_uses_system_temp(monkeypatch, tmp_path):
    from tempfile import gettempdir

    monkeypatch.setenv("HDR_FINISHER_PROOF_ROOT", "")
    monkeypatch.chdir(tmp_path)
    store = ProofArtifactStore()
    try:
        assert store.root.parent == Path(gettempdir())
        assert not list(tmp_path.iterdir())
    finally:
        store.clear()


def test_delivery_test_pattern_is_float_hdr_and_has_known_patch_range() -> None:
    response = client.get("/api/proof/test-pattern")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/tiff"
    pattern = tifffile.imread(BytesIO(response.content))
    assert pattern.shape == (720, 1280, 3)
    assert pattern.dtype == np.float32
    assert float(pattern.max()) >= 5.7
    assert float(pattern.min()) >= 0.0


def test_gain_map_formula_matches_known_whole_stop_targets() -> None:
    base = np.full((2, 3, 3), 0.125, dtype=np.float32)
    gain = np.ones_like(base)
    parameters = GainMapParameters(
        display_ratio_sdr=1.0,
        display_ratio_hdr=16.0,
        gain_min=np.zeros(3, dtype=np.float32),
        gain_max=np.full(3, np.log(16.0), dtype=np.float32),
        gamma=np.ones(3, dtype=np.float32),
        epsilon_sdr=np.zeros(3, dtype=np.float32),
        epsilon_hdr=np.zeros(3, dtype=np.float32),
    )

    np.testing.assert_allclose(apply_gain_map_formula(base, gain, parameters, 0.0), base, rtol=1e-6)
    np.testing.assert_allclose(apply_gain_map_formula(base, gain, parameters, 2.0), base * 4.0, rtol=1e-6)
    np.testing.assert_allclose(apply_gain_map_formula(base, gain, parameters, 4.0), base * 16.0, rtol=1e-6)


def test_endpoint_reconstruction_preserves_base_and_alternate() -> None:
    base = np.linspace(0.02, 0.5, 36, dtype=np.float32).reshape(3, 4, 3)
    alternate = base * np.array([4.0, 3.0, 2.0], dtype=np.float32)
    np.testing.assert_allclose(reconstruct_from_endpoints(base, alternate, 3.0, 0.0), base, atol=2e-6)
    np.testing.assert_allclose(reconstruct_from_endpoints(base, alternate, 3.0, 3.0), alternate, atol=2e-5)


@pytest.mark.parametrize(
    ("peak_nits", "expected_headroom"),
    [(400, math.log2(400 / 203)), (600, math.log2(600 / 203)), (1000, math.log2(1000 / 203)), (2000, math.log2(2000 / 203)), (4000, math.log2(4000 / 203))],
)
def test_chrome_proof_nit_presets_use_project_reference_white(peak_nits: float, expected_headroom: float) -> None:
    assert target_headroom_for_peak_nits(peak_nits) == pytest.approx(expected_headroom)


def test_endpoint_reconstruction_uses_encoded_offsets_and_clamps_above_capacity() -> None:
    base = np.array([[[0.0, 0.02, 0.4], [0.08, 0.25, 0.7]]], dtype=np.float32)
    alternate = np.array([[[0.001, 0.18, 1.2], [0.5, 1.5, 3.0]]], dtype=np.float32)
    midpoint = reconstruct_from_endpoints(
        base,
        alternate,
        2.0,
        1.0,
        display_ratio_sdr=1.0,
        offset_sdr=1e-7,
        offset_hdr=2e-7,
    )
    full = reconstruct_from_endpoints(
        base,
        alternate,
        2.0,
        12.0,
        display_ratio_sdr=1.0,
        offset_sdr=1e-7,
        offset_hdr=2e-7,
    )
    assert np.all(midpoint >= 0)
    assert np.any(np.abs(midpoint - reconstruct_from_endpoints(base, alternate, 2.0, 1.0)) > 1e-5)
    np.testing.assert_allclose(full, alternate, rtol=2e-5, atol=2e-6)


def test_jpeg_probe_metadata_is_parsed_into_structured_fields(monkeypatch, tmp_path: Path) -> None:
    probe = """
--maxContentBoost 16
--offsetSdr 1e-07
--offsetHdr 2e-07
--hdrCapacityMin 1.25
--hdrCapacityMax 8
--useBaseColorSpace 1
"""
    monkeypatch.setattr(proofing_module, "resolve_binary", lambda _name: tmp_path / "ultrahdr_app.exe")
    monkeypatch.setattr(
        proofing_module,
        "_run_command",
        lambda command: type("Result", (), {"stdout": probe, "stderr": ""})(),
    )
    metadata = _inspect_jpeg_gain_map(tmp_path / "proof.jpg")
    assert metadata.use_base_color_space is True
    assert metadata.base_gamut == "sRGB / BT.709"
    assert metadata.alternate_gamut == "BT.2020"
    assert metadata.reconstruction_gamut == "sRGB / BT.709"
    assert metadata.max_content_boost == pytest.approx(16.0)
    assert metadata.hdr_capacity_min == pytest.approx(1.25)
    assert metadata.hdr_capacity_max == pytest.approx(8.0)
    assert metadata.offset_sdr == pytest.approx(1e-7)
    assert metadata.offset_hdr == pytest.approx(2e-7)


@pytest.mark.parametrize("use_base_color_space", [True, False])
def test_jpeg_full_endpoint_uses_metadata_selected_decoded_gamut(
    monkeypatch,
    tmp_path: Path,
    use_base_color_space: bool,
) -> None:
    store = ProofArtifactStore()
    store.root = tmp_path
    jpeg_path = tmp_path / "fixture.jpg"
    Image.new("RGB", (2, 1), (64, 96, 128)).save(jpeg_path, quality=95)
    decoded = np.array([[[0.9, 0.15, 0.05], [0.1, 0.7, 0.2]]], dtype=np.float32)
    decoded_rgba = np.concatenate([decoded, np.ones((1, 2, 1), dtype=np.float32)], axis=2)
    decoded_rgba.astype("<f2").tofile(tmp_path / "decoded-gamut-test.rgba-f16.raw")
    metadata = JPEGGainMapProofMetadata(
        use_base_color_space=use_base_color_space,
        base_gamut="sRGB / BT.709",
        alternate_gamut="BT.2020",
        reconstruction_gamut="sRGB / BT.709" if use_base_color_space else "BT.2020",
        min_content_boost=1.0,
        max_content_boost=8.0,
        gamma=1.0,
        hdr_capacity_min=1.0,
        hdr_capacity_max=8.0,
        offset_sdr=1e-7,
        offset_hdr=1e-7,
    )
    artifact = ProofArtifact(
        artifact_id="gamut-test",
        format="jpeg_ultrahdr",
        path=jpeg_path,
        media_type="image/jpeg",
        sha256="0" * 64,
        width=2,
        height=1,
        quality=85,
        metadata_summary="fixture",
        encoded_headroom=3.0,
        reference_white_nits=203,
        hdr_authored=np.zeros((1, 2, 3), dtype=np.float32),
        sdr_authored=np.zeros((1, 2, 3), dtype=np.float32),
        jpeg_gain_map=metadata,
    )
    monkeypatch.setattr(proofing_module, "resolve_binary", lambda _name: tmp_path / "ultrahdr_app.exe")
    _, endpoint = store._matrix_endpoints(artifact)
    scaled = decoded * np.float32(0.18)
    expected = linear_srgb_to_acescg(scaled) if use_base_color_space else linear_bt2020_to_acescg(scaled)
    np.testing.assert_allclose(endpoint, np.clip(expected, 0, None), rtol=2e-3, atol=3e-4)

    expected_sum = np.maximum(expected.sum(axis=-1, keepdims=True), 1e-8)
    endpoint_sum = np.maximum(endpoint.sum(axis=-1, keepdims=True), 1e-8)
    mean_chromaticity_error = float(np.mean(np.abs(endpoint / endpoint_sum - expected / expected_sum)))
    assert mean_chromaticity_error < 0.01


def test_jpeg_matrix_endpoints_publish_decode_atomically_for_concurrent_targets(
    monkeypatch,
    tmp_path: Path,
) -> None:
    store = ProofArtifactStore()
    store.root = tmp_path
    jpeg_path = tmp_path / "concurrent.jpg"
    Image.new("RGB", (2, 2), (64, 96, 128)).save(jpeg_path, quality=95)
    decoded = np.array(
        [
            [[0.9, 0.15, 0.05], [0.1, 0.7, 0.2]],
            [[0.2, 0.3, 0.8], [0.6, 0.5, 0.1]],
        ],
        dtype=np.float32,
    )
    decoded_rgba = np.concatenate([decoded, np.ones((2, 2, 1), dtype=np.float32)], axis=2)
    metadata = JPEGGainMapProofMetadata(
        use_base_color_space=True,
        base_gamut="sRGB / BT.709",
        alternate_gamut="BT.2020",
        reconstruction_gamut="sRGB / BT.709",
        min_content_boost=1.0,
        max_content_boost=8.0,
        gamma=1.0,
        hdr_capacity_min=1.0,
        hdr_capacity_max=8.0,
        offset_sdr=1e-7,
        offset_hdr=1e-7,
    )
    artifact = ProofArtifact(
        artifact_id="concurrent-decode",
        format="jpeg_ultrahdr",
        path=jpeg_path,
        media_type="image/jpeg",
        sha256="0" * 64,
        width=2,
        height=2,
        quality=85,
        metadata_summary="fixture",
        encoded_headroom=3.0,
        reference_white_nits=203,
        hdr_authored=np.zeros((2, 2, 3), dtype=np.float32),
        sdr_authored=np.zeros((2, 2, 3), dtype=np.float32),
        jpeg_gain_map=metadata,
    )
    decode_started = Event()
    release_decode = Event()
    final_path = tmp_path / "decoded-concurrent-decode.rgba-f16.raw"
    decode_outputs: list[Path] = []

    def fake_run(command: list[str]) -> None:
        output = Path(command[command.index("-z") + 1])
        decode_outputs.append(output)
        assert output != final_path
        output.write_bytes(bytes(decoded_rgba.astype("<f2").nbytes))
        decode_started.set()
        assert release_decode.wait(timeout=2)
        decoded_rgba.astype("<f2").tofile(output)

    monkeypatch.setattr(proofing_module, "resolve_binary", lambda _name: tmp_path / "ultrahdr_app.exe")
    monkeypatch.setattr(proofing_module, "_run_command", fake_run)

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(store._matrix_endpoints, artifact)
        assert decode_started.wait(timeout=2)
        second = executor.submit(store._matrix_endpoints, artifact)
        try:
            completed, _ = wait([second], timeout=0.1)
            assert not completed
        finally:
            release_decode.set()
        first_endpoints = first.result(timeout=2)
        second_endpoints = second.result(timeout=2)

    expected = linear_srgb_to_acescg(decoded * np.float32(0.18))
    np.testing.assert_allclose(first_endpoints[1], np.clip(expected, 0, None), rtol=2e-3, atol=3e-4)
    assert second_endpoints is first_endpoints
    assert decode_outputs and len(decode_outputs) == 1
    assert final_path.exists()
    assert final_path.stat().st_size == decoded_rgba.astype("<f2").nbytes


def test_banded_jpeg_proof_matches_whole_image_tiles(tmp_path: Path) -> None:
    if proofing_module.resolve_binary("avifenc") is None:
        pytest.skip("AVIF preview encoder unavailable")
    store = ProofArtifactStore()
    width, height = 71, 263
    rng = np.random.default_rng(34)
    jpeg = tmp_path / "base.jpg"
    Image.fromarray(rng.integers(0, 256, (height, width, 3), dtype=np.uint8)).save(jpeg)
    raw = tmp_path / "decoded-strip-proof.rgba-f16.raw"
    rgba = rng.random((height, width, 4), dtype=np.float32) * np.float32(6)
    rgba[-1, -1, :3] = [10, 0, 12]  # The final partial band changes the global extrema.
    rgba.astype("<f2").tofile(raw)
    artifact = ProofArtifact(
        artifact_id="strip-proof", format="jpeg_ultrahdr", path=jpeg, media_type="image/jpeg",
        sha256="", width=width, height=height, quality=90, metadata_summary="", encoded_headroom=3,
        reference_white_nits=100, hdr_authored=None, sdr_authored=None, jpeg_decoded=raw,
    )
    with Image.open(jpeg) as primary:
        base = proofing_module._jpeg_base_endpoint(primary.convert("RGB"))
    alternate = proofing_module._jpeg_alternate_endpoint(rgba.astype("<f2"), artifact.reference_white_nits, True)
    for target in (1.75, 0.0, 3.0):
        banded, peak, clipped = store._jpeg_target_tile(artifact, target)
        whole = reconstruct_from_endpoints(base, alternate, artifact.encoded_headroom, target)
        assert banded == proofing_module._encode_hdr_avif(whole, artifact.reference_white_nits, quality=proofing_module.PROOF_TILE_QUALITY)
        assert (peak, clipped) == proofing_module._image_stats(whole, target, artifact.reference_white_nits)


@pytest.mark.parametrize("format, use_tonemap", [
    ("avif_gain_map", True),
    ("avif_gain_map", False),
    ("jpegxl_hdr", False),
])
@pytest.mark.parametrize("invalid", [False, True])
def test_banded_authored_proof_matches_whole_image_tiles(monkeypatch, tmp_path, format, use_tonemap, invalid):
    resolve = proofing_module.resolve_binary
    if resolve("avifgainmaputil" if use_tonemap else "avifenc") is None:
        pytest.skip("Native AVIF tile helper unavailable")
    if not use_tonemap:
        monkeypatch.setattr(proofing_module, "resolve_binary",
                            lambda name: None if name == "avifgainmaputil" else resolve(name))
    monkeypatch.setattr(proofing_module, "_PROOF_RECONSTRUCTION_ROWS", 8)

    height, width = 29, 37
    rng = np.random.default_rng(25)
    base = rng.random((height, width, 3), dtype=np.float32) * 0.7
    alternate = rng.random(base.shape, dtype=np.float32) * 7
    path = tmp_path / "artifact.avif"
    if use_tonemap:
        write_avif_gainmap_renditions(
            path, alternate, base, ExportSettings(output_path=str(path), format=format),
        )
    base[0, 0] = alternate[0, 0] = 0
    base[-1, -1] = [0.0, 2.0, 0.001]
    alternate[-1, -1] = [1e20, 0.0, 200.0]  # Extrema in the last partial band.
    if invalid:
        base[1, 1, 0] = alternate[1, 1, 0] = np.inf
        alternate[-1, 0, 1] = np.nan

    artifact = ProofArtifact(
        artifact_id="authored-proof", format=format, path=path, media_type="image/avif",
        sha256="", width=width, height=height, quality=90, metadata_summary="", encoded_headroom=3,
        reference_white_nits=203, hdr_authored=alternate, sdr_authored=base, full_size=True,
    )
    store = ProofArtifactStore()
    legacy_store = ProofArtifactStore()
    from_files = replace(artifact,
        hdr_authored=DeliveryFrame.spill(tmp_path / "hdr.rgb", alternate),
        sdr_authored=DeliveryFrame.spill(tmp_path / "sdr.rgb", base))

    with np.errstate(invalid="ignore"):
        for target in (1.75, 0.0, 3.0):
            whole = reconstruct_from_endpoints(base, alternate, artifact.encoded_headroom, target)
            expected = legacy_store._encoded_matrix_tile(replace(artifact, full_size=False), target, whole)
            banded, peak, clipped = store._authored_target_tile(artifact, target)
            assert banded == expected
            assert (peak, clipped) == proofing_module._image_stats(whole, target, artifact.reference_white_nits)
            assert store._authored_target_tile(from_files, target) == (banded, peak, clipped)

            tile = store._target_tile(artifact, target, "Target", None)
            assert store.tile(tile.id).path.read_bytes() == expected
            assert (tile.peak_nits, tile.clipped_percent) == (round(peak, 1), round(clipped, 3))


def test_full_size_avif_tile_matches_legacy_above_automatic_tiling_threshold(tmp_path):
    utility = proofing_module.resolve_binary("avifgainmaputil")
    if utility is None or proofing_module.resolve_binary("avifenc") is None:
        pytest.skip("Native AVIF tile helpers unavailable")
    # Over 512 * 512 pixels so default avifenc settings can choose multiple tiles.
    height, width = 608, 896
    x = np.linspace(.01, .65, width, dtype=np.float32)[None, :, None]
    y = np.linspace(.01, .2, height, dtype=np.float32)[:, None, None]
    base = (x + y) * np.array([1, .9, .6], dtype=np.float32)
    alternate = base * np.array([2.3, 3.5, 3.1], dtype=np.float32)
    path = tmp_path / "artifact.avif"
    write_avif_gainmap_renditions(path, alternate, base, ExportSettings(output_path=str(path), format="avif_gain_map"))
    artifact = ProofArtifact(
        artifact_id="with-split", format="avif_gain_map", path=path, media_type="image/avif",
        sha256="", width=width, height=height, quality=90, metadata_summary="", encoded_headroom=2,
        reference_white_nits=203, hdr_authored=None, sdr_authored=None, full_size=True,
    )
    store = ProofArtifactStore()
    try:
        legacy = replace(artifact, artifact_id="one-step", full_size=False)
        assert store._tonemap_avif_tile(artifact, 1.0, utility) == store._tonemap_avif_tile(legacy, 1.0, utility)
        assert not list(store.root.rglob("*.y4m"))
    finally:
        store.clear()


class _FakeBackend:
    def __init__(self) -> None:
        self.last_settings = None

    def export(self, session: object, settings: object) -> ExportResponse:
        self.last_settings = settings
        output = Path(getattr(settings, "output_path"))
        assert getattr(settings, "overwrite") is True
        output.write_bytes(b"encoded-proof-artifact")
        assert getattr(session, "image").shape[:2] == (12, 16)
        return ExportResponse(accepted=True, backend="fake", message="ok", output_path=str(output))


def test_full_size_proof_evicts_old_endpoint_files_and_keeps_the_encoded_artifact(monkeypatch):
    class Backend(_FakeBackend):
        def export(self, session, settings):
            response = super().export(session, settings)
            Path(response.output_path).write_bytes(bytes([settings.quality]))
            return response

    image = np.full((12, 16, 3), 0.18, dtype=np.float32)
    session = type("Session", (), {"session_id": "evict", "render_cache": SessionRenderCache(image, None)})()
    monkeypatch.setattr(proofing_module, "_inspect_artifact", lambda *_args: (3.0, "test metadata"))
    monkeypatch.setattr(proofing_module, "_render_export_branch", lambda *_args, **_kwargs: image)
    store = ProofArtifactStore()
    backend = Backend()
    try:
        artifacts = []
        for quality in (90, 91, 92):
            response = store.create(session, ProofArtifactRequest(
                adjustments=AdjustmentState(), format="avif_gain_map", quality=quality, full_size=True,
            ), backend)
            artifact = store.artifact(response.artifact_id)
            artifacts.append((artifact, artifact.hdr_authored.path))
        old, path = artifacts[0]
        assert not path.exists()
        assert store.artifact(old.artifact_id).path.read_bytes() == bytes([90])
        assert all(path.exists() for _, path in artifacts[1:])
        with pytest.raises(KeyError, match="Refresh Proof"):
            store.matrix(old.artifact_id, None)
    finally:
        store.clear()


class _FailOnceWithPartialArtifactBackend:
    def __init__(self) -> None:
        self.calls = 0

    def export(self, _session: object, settings: object) -> ExportResponse:
        self.calls += 1
        output = Path(getattr(settings, "output_path"))
        output.write_bytes(b"partial" if self.calls == 1 else b"encoded-proof-artifact")
        return ExportResponse(
            accepted=self.calls > 1,
            backend="fake",
            message="simulated interrupted proof build",
            output_path=str(output) if self.calls > 1 else None,
        )


def test_proof_proxy_preserves_local_adjustments_and_delivery_notes(monkeypatch, tmp_path: Path) -> None:
    captured = {}

    class CapturingBackend(_FakeBackend):
        def export(self, session: object, settings: object) -> ExportResponse:
            captured["locals"] = getattr(session, "local_adjustments")
            result = super().export(session, settings)
            result.delivery_notes = ["HDR peak is 1012 nits, 12 above the 1000-nit target after correction; the file was exported anyway."]
            return result

    proof_store = ProofArtifactStore()
    proof_store.root = tmp_path
    image = np.full((12, 16, 3), 0.18, dtype=np.float32)
    local_sentinel = [object()]
    session = type(
        "Session",
        (),
        {
            "session_id": "proof-edit-parity",
            "render_cache": SessionRenderCache(image, None),
            "local_adjustments": local_sentinel,
        },
    )()
    monkeypatch.setattr(proofing_module, "_inspect_artifact", lambda *_args: (3.0, "test metadata"))
    monkeypatch.setattr(
        proofing_module,
        "_render_export_branch",
        lambda *_args, **_kwargs: np.full((12, 16, 3), 0.18, dtype=np.float32),
    )

    proof = proof_store.create(
        session,
        ProofArtifactRequest(adjustments=AdjustmentState(), format="jpeg_ultrahdr", long_edge=256),
        CapturingBackend(),
    )

    assert captured == {"locals": local_sentinel}
    assert "12 above the 1000-nit target" in proof.delivery_notes[0]
    cached = proof_store.create(session,
        ProofArtifactRequest(adjustments=AdjustmentState(), format="jpeg_ultrahdr", long_edge=256), CapturingBackend())
    assert cached.delivery_notes == proof.delivery_notes


def test_proof_proxy_preserves_denoise(monkeypatch, tmp_path: Path) -> None:
    """A proof claims to show the delivered file; the export carries denoise.

    The proof proxy is a reduced session, so anything the export graph reads
    from the session and the proxy omits silently disappears from the proof.
    Denoise is authored beside the grade and read from the session, so it has
    to survive the reduction.
    """
    captured = {}

    class CapturingBackend(_FakeBackend):
        def export(self, session: object, settings: object) -> ExportResponse:
            captured["denoise"] = getattr(session, "denoise", None)
            return super().export(session, settings)

    proof_store = ProofArtifactStore()
    proof_store.root = tmp_path
    image = np.full((12, 16, 3), 0.18, dtype=np.float32)
    denoise_sentinel = object()
    session = type(
        "Session",
        (),
        {
            "session_id": "proof-denoise-parity",
            "render_cache": SessionRenderCache(image, None),
            "denoise": denoise_sentinel,
        },
    )()
    monkeypatch.setattr(proofing_module, "_inspect_artifact", lambda *_args: (3.0, "test metadata"))
    monkeypatch.setattr(
        proofing_module,
        "_render_export_branch",
        lambda *_args, **_kwargs: np.full((12, 16, 3), 0.18, dtype=np.float32),
    )

    proof_store.create(
        session,
        ProofArtifactRequest(adjustments=AdjustmentState(), format="jpeg_ultrahdr", long_edge=256),
        CapturingBackend(),
    )

    assert captured == {"denoise": denoise_sentinel}


def test_proof_signature_tracks_denoise_state() -> None:
    """Denoise is not part of the request, so the signature must fold it in.

    Without this, a proof built before a denoise change would be served for it
    unchanged and would silently describe a different file.
    """
    request = ProofArtifactRequest(adjustments=AdjustmentState(), format="jpeg_ultrahdr", long_edge=256)
    context = RenderColorContext()
    enabled = DenoiseDocumentSettings()
    enabled.hdr.enabled = True
    enabled.hdr.controls.amount = 0.8
    disabled = DenoiseDocumentSettings()

    simple_off = disabled.model_copy(deep=True)
    simple_off.hdr.controls.method = "standard"
    signature = lambda request, denoise: ProofArtifactStore._request_signature("session", request, context, denoise)
    assert signature(request, None) == signature(request, disabled)
    assert signature(request, disabled) == signature(request.model_copy(update={"edit_revision": 1}), simple_off)
    assert signature(request, enabled) != signature(request, disabled)


def test_failed_proof_build_cleans_internal_staging_file_before_retry(monkeypatch, tmp_path: Path) -> None:
    store = ProofArtifactStore()
    store.root = tmp_path
    image = np.full((12, 16, 3), 0.18, dtype=np.float32)
    session = type(
        "Session",
        (),
        {"session_id": "proof-retry", "render_cache": SessionRenderCache(image, None)},
    )()
    request = ProofArtifactRequest(adjustments=AdjustmentState(), format="jpeg_ultrahdr", long_edge=256)
    backend = _FailOnceWithPartialArtifactBackend()
    monkeypatch.setattr(proofing_module, "_inspect_artifact", lambda *_args: (3.0, "test metadata"))

    with pytest.raises(RuntimeError, match="simulated interrupted proof build"):
        store.create(session, request, backend)

    assert list(tmp_path.glob("request-*")) == []
    response = store.create(session, request, backend)
    assert response.artifact_id
    assert list(tmp_path.glob("request-*")) == []


def _proof_race_session():
    image = np.full((12, 16, 3), 0.18, dtype=np.float32)
    return type(
        "Session",
        (),
        {"session_id": "proof-race", "render_cache": SessionRenderCache(image, None)},
    )()


def test_concurrent_builds_of_the_same_grade_publish_one_artifact(monkeypatch, tmp_path: Path) -> None:
    """Losing the publish race means the identical bytes already landed.

    Artifacts are named by content digest, so two builds of one grade target the
    same destination. On Windows the loser's rename is denied because the winner
    already holds the file open, which surfaced to the user as a 500.
    """
    store = ProofArtifactStore()
    store.root = tmp_path
    request = ProofArtifactRequest(adjustments=AdjustmentState(), format="jpeg_ultrahdr", long_edge=256)
    monkeypatch.setattr(proofing_module, "_inspect_artifact", lambda *_args: (3.0, "test metadata"))

    original_replace = Path.replace
    calls = []

    def losing_replace(self: Path, target):
        calls.append(target)
        # Stand in for the winning build: the destination is already published
        # and still open, so this rename is refused.
        Path(target).write_bytes(self.read_bytes())
        raise PermissionError(5, "Access is denied")

    monkeypatch.setattr(Path, "replace", losing_replace)
    response = store.create(_proof_race_session(), request, _FakeBackend())

    assert calls, "the publish path should still attempt the rename"
    assert response.artifact_id
    assert store.artifact(response.artifact_id).path.exists()
    assert list(tmp_path.glob("request-*")) == [], "the staged copy must not be left behind"

    monkeypatch.setattr(Path, "replace", original_replace)
    again = store.create(_proof_race_session(), request, _FakeBackend())
    assert again.artifact_id == response.artifact_id


def test_publish_failure_without_a_winner_is_still_reported(monkeypatch, tmp_path: Path) -> None:
    """Only a genuine race is absorbed; a rename that publishes nothing must raise."""
    store = ProofArtifactStore()
    store.root = tmp_path
    request = ProofArtifactRequest(adjustments=AdjustmentState(), format="jpeg_ultrahdr", long_edge=256)
    monkeypatch.setattr(proofing_module, "_inspect_artifact", lambda *_args: (3.0, "test metadata"))

    def failing_replace(self: Path, target):
        raise PermissionError(5, "Access is denied")

    monkeypatch.setattr(Path, "replace", failing_replace)

    with pytest.raises(PermissionError):
        store.create(_proof_race_session(), request, _FakeBackend())


def test_jpegxl_direct_hdr_is_available_as_a_proof_artifact(monkeypatch, tmp_path: Path) -> None:
    store = ProofArtifactStore()
    store.root = tmp_path
    image = np.full((12, 16, 3), 0.18, dtype=np.float32)
    session = type(
        "Session",
        (),
        {"session_id": "proof-jpegxl", "render_cache": SessionRenderCache(image, None)},
    )()
    request = ProofArtifactRequest(
        adjustments=AdjustmentState(),
        format="jpegxl_hdr",
        jpegxl_precision="float32",
        long_edge=256,
    )
    monkeypatch.setattr(
        proofing_module,
        "_inspect_artifact",
        lambda *_args: (math.log2(100.0), "Direct HDR JPEG XL; Rec.2020 PQ; 12-bit"),
    )

    backend = _FakeBackend()
    response = store.create(session, request, backend)

    assert response.format == "jpegxl_hdr"
    assert backend.last_settings.jpegxl_precision == "float32"
    assert response.media_type == "image/jxl"
    assert response.url.endswith(f"{response.artifact_id}.jxl")
    assert store.artifact(response.artifact_id).path.suffix == ".jxl"


def test_artifact_is_content_hashed_cached_and_matrix_is_stable(monkeypatch, tmp_path: Path) -> None:
    store = ProofArtifactStore()
    store.root = tmp_path
    image = np.full((12, 16, 3), 0.18, dtype=np.float32)
    session = type(
        "Session",
        (),
        {"session_id": "proof-session", "render_cache": SessionRenderCache(image, None)},
    )()
    request = ProofArtifactRequest(adjustments=AdjustmentState(), format="jpeg_ultrahdr", long_edge=256)
    monkeypatch.setattr(proofing_module, "_inspect_artifact", lambda *_args: (3.0, "test metadata"))
    monkeypatch.setattr(store, "_matrix_endpoints", lambda artifact: (artifact.sdr_authored, artifact.hdr_authored))
    monkeypatch.setattr(store, "_encoded_matrix_tile", lambda *_args: b"stable-tile")

    first = store.create(session, request, _FakeBackend())
    second = store.create(session, request, _FakeBackend())
    matrix = store.matrix(first.artifact_id, display_headroom=1.5)
    fixed = store.reconstruction(
        ProofReconstructionRequest(
            artifact_id=first.artifact_id,
            target={"mode": "fixed", "peak_nits": 400, "display_id": "display-1"},
        ),
        [{"id": "display-1", "name": "Reference display", "nominal_headroom": 4.0, "max_luminance_nits": 1600}],
    )
    fixed_again = store.reconstruction(
        ProofReconstructionRequest(
            artifact_id=first.artifact_id,
            target={"mode": "fixed", "peak_nits": 400, "display_id": "display-1"},
        ),
        [{"id": "display-1", "name": "Reference display", "nominal_headroom": 4.0, "max_luminance_nits": 1600}],
    )
    auto = store.reconstruction(
        ProofReconstructionRequest(
            artifact_id=first.artifact_id,
            target={"mode": "auto", "display_id": "display-1"},
        ),
        [{"id": "display-1", "name": "Reference display", "nominal_headroom": 1.5, "max_luminance_nits": 1000}],
    )
    capped = store.reconstruction(
        ProofReconstructionRequest(
            artifact_id=first.artifact_id,
            target={"mode": "fixed", "peak_nits": 10000},
        ),
        [],
    )
    with pytest.raises(ValueError, match="display headroom"):
        store.reconstruction(
            ProofReconstructionRequest(artifact_id=first.artifact_id, target={"mode": "auto"}),
            [],
        )

    assert first.artifact_id == second.artifact_id
    assert first.sha256 == second.sha256
    assert first.url.endswith(f"{first.artifact_id}.jpg")
    assert len(matrix.tiles) == 5
    assert matrix.tiles[0].above_display_headroom is False
    assert matrix.tiles[-1].above_display_headroom is True
    assert fixed.resolved_headroom == pytest.approx(math.log2(400 / 203), abs=5e-5)
    assert fixed.tile.id == matrix.tiles[2].id
    assert fixed_again.cache_id == fixed.cache_id
    assert fixed_again.tile.id == fixed.tile.id
    assert fixed.display_can_represent is True
    assert auto.resolved_headroom == pytest.approx(1.5)
    assert auto.display_label == "Reference display"
    assert capped.resolved_headroom == pytest.approx(3.0)
    assert capped.capped_by_encoded_headroom is True


def test_auto_reconstruction_requires_display_headroom() -> None:
    response = client.post(
        "/api/proof/reconstruction",
        json={"artifact_id": "missing", "target": {"mode": "auto"}},
    )
    assert response.status_code == 404

    validation = client.post(
        "/api/proof/reconstruction",
        json={"artifact_id": "missing", "target": {"mode": "fixed"}},
    )
    assert validation.status_code == 422
    for invalid_peak in (99, 10001):
        bounds = client.post(
            "/api/proof/reconstruction",
            json={"artifact_id": "missing", "target": {"mode": "fixed", "peak_nits": invalid_peak}},
        )
        assert bounds.status_code == 422


@pytest.mark.parametrize(
    ("format_name", "capability_name", "suffix", "media_type"),
    [
        ("jpeg_ultrahdr", "ultrahdr_encoder", ".jpg", "image/jpeg"),
        ("avif_gain_map", "avif_gain_map_encoder", ".avif", "image/avif"),
    ],
)
def test_real_proof_artifact_and_matrix_endpoints(
    format_name: str,
    capability_name: str,
    suffix: str,
    media_type: str,
) -> None:
    if get_capabilities()[capability_name].status != CapabilityStatus.AVAILABLE:
        pytest.skip(get_capabilities()[capability_name].detail)
    fixture = Path(__file__).resolve().parent / "fixtures" / "hdr_headroom.tiff"
    upload = client.post("/api/session", files={"file": (fixture.name, fixture.read_bytes(), "image/tiff")})
    assert upload.status_code == 200
    session = upload.json()["session"]

    artifact_response = client.post(
        f"/api/session/{session['session_id']}/proof/artifact",
        json={
            "adjustments": session["adjustments"],
            "format": format_name,
            "quality": 88,
            "long_edge": 256,
        },
    )
    assert artifact_response.status_code == 200, artifact_response.text
    artifact = artifact_response.json()
    assert artifact["url"].endswith(suffix)
    assert artifact["encoded_headroom"] > 0
    delivered = client.get(artifact["url"])
    assert delivered.status_code == 200
    assert delivered.headers["content-type"] == media_type
    assert delivered.headers["x-content-sha256"] == artifact["sha256"]

    wrong_mime = client.get(artifact["wrong_mime_url"])
    assert wrong_mime.headers["content-type"] == "application/octet-stream"

    matrix_response = client.post(
        "/api/proof/matrix",
        json={"artifact_id": artifact["artifact_id"], "display_headroom": 2.0},
    )
    assert matrix_response.status_code == 200, matrix_response.text
    matrix = matrix_response.json()
    assert len(matrix["tiles"]) >= 5
    assert all(client.get(tile["url"]).status_code == 200 for tile in matrix["tiles"])

    reconstruction_response = client.post(
        "/api/proof/reconstruction",
        json={
            "artifact_id": artifact["artifact_id"],
            "target": {"mode": "fixed", "peak_nits": 1000},
        },
    )
    assert reconstruction_response.status_code == 200, reconstruction_response.text
    reconstruction = reconstruction_response.json()
    assert reconstruction["format"] == format_name
    assert reconstruction["target_label"] == "1000 nits"
    assert reconstruction["resolved_headroom"] <= reconstruction["encoded_headroom"]
    assert client.get(reconstruction["tile"]["url"]).status_code == 200
    session_store.clear()


@pytest.mark.parametrize(("bit_depth", "chroma"), [(8, "420"), (10, "422"), (12, "444")])
def test_real_avif_proof_honors_primary_precision_and_chroma(bit_depth: int, chroma: str) -> None:
    if get_capabilities()["avif_gain_map_encoder"].status != CapabilityStatus.AVAILABLE:
        pytest.skip(get_capabilities()["avif_gain_map_encoder"].detail)
    fixture = Path(__file__).resolve().parent / "fixtures" / "hdr_headroom.tiff"
    upload = client.post("/api/session", files={"file": (fixture.name, fixture.read_bytes(), "image/tiff")})
    assert upload.status_code == 200
    session = upload.json()["session"]

    response = client.post(
        f"/api/session/{session['session_id']}/proof/artifact",
        json={
            "adjustments": session["adjustments"],
            "format": "avif_gain_map",
            "quality": 88,
            "long_edge": 256,
            "avif_bit_depth": bit_depth,
            "avif_chroma_subsampling": chroma,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["url"].endswith(".avif")
    session_store.clear()


@pytest.mark.parametrize("gain_map_chroma", ["444", "422", "420", "400"])
def test_real_avif_proof_honors_gain_map_chroma(gain_map_chroma: str) -> None:
    if get_capabilities()["avif_gain_map_encoder"].status != CapabilityStatus.AVAILABLE:
        pytest.skip(get_capabilities()["avif_gain_map_encoder"].detail)
    fixture = Path(__file__).resolve().parent / "fixtures" / "hdr_headroom.tiff"
    upload = client.post("/api/session", files={"file": (fixture.name, fixture.read_bytes(), "image/tiff")})
    assert upload.status_code == 200
    session = upload.json()["session"]

    response = client.post(
        f"/api/session/{session['session_id']}/proof/artifact",
        json={
            "adjustments": session["adjustments"],
            "format": "avif_gain_map",
            "quality": 88,
            "long_edge": 256,
            "avif_bit_depth": 10,
            "avif_chroma_subsampling": "444",
            "avif_gain_map_chroma_subsampling": gain_map_chroma,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["url"].endswith(".avif")
    session_store.clear()


def test_forced_build_re_encodes_instead_of_replaying_the_cache(monkeypatch, tmp_path: Path) -> None:
    """Build proof is the escape hatch when the cached artifact is suspect.

    Replaying the cache makes the button look inert exactly when someone reaches
    for it, so an explicit build re-runs the encoder while still landing on the
    same cache entry an ordinary request would.
    """
    store = ProofArtifactStore()
    store.root = tmp_path
    image = np.full((12, 16, 3), 0.18, dtype=np.float32)
    session = type(
        "Session",
        (),
        {"session_id": "proof-session", "render_cache": SessionRenderCache(image, None)},
    )()
    monkeypatch.setattr(proofing_module, "_inspect_artifact", lambda *_args: (3.0, "test metadata"))
    monkeypatch.setattr(store, "_matrix_endpoints", lambda artifact: (artifact.sdr_authored, artifact.hdr_authored))
    monkeypatch.setattr(store, "_encoded_matrix_tile", lambda *_args: b"stable-tile")

    encodes = 0

    class CountingBackend(_FakeBackend):
        def export(self, session, settings):
            nonlocal encodes
            encodes += 1
            return super().export(session, settings)

    request = ProofArtifactRequest(adjustments=AdjustmentState(), format="jpeg_ultrahdr", long_edge=256)
    first = store.create(session, request, CountingBackend())
    store.create(session, request, CountingBackend())
    assert encodes == 1, "an unforced repeat should replay the cached artifact"

    forced = ProofArtifactRequest(
        adjustments=AdjustmentState(), format="jpeg_ultrahdr", long_edge=256, force=True
    )
    rebuilt = store.create(session, forced, CountingBackend())
    assert encodes == 2, "an explicit build must re-run the encoder"
    # Identical input still yields identical content, so the artifact identity
    # and every tile derived from it stay stable across a forced rebuild.
    assert rebuilt.artifact_id == first.artifact_id


def test_proof_signature_tracks_local_adjustments() -> None:
    """Locals live on the session, so a proof made before a Local edit must not
    be reused for it when the request has no edit revision."""
    from hdr_finisher.models import LocalAdjustment, MaskExpression, MaskLeaf
    request = ProofArtifactRequest(adjustments=AdjustmentState(), format="jpeg_ultrahdr", long_edge=256)
    context = RenderColorContext()
    local = LocalAdjustment(mask=MaskExpression(operator="leaf", leaf=MaskLeaf(
        type="hue_range", hue_center=109, hue_width=24, hue_smoothness=41)))
    edited = local.model_copy(deep=True)
    edited.sdr_grade.exposure = 1.05
    signature = lambda locals_: ProofArtifactStore._request_signature("session", request, context, local_adjustments=locals_)
    assert len({signature(None), signature([local]), signature([edited])}) == 3
    assert signature([local]) == signature([local.model_copy(deep=True)])


def test_proof_endpoint_failure_closes_source_bands_before_cleanup(monkeypatch, tmp_path):
    from types import SimpleNamespace

    monkeypatch.setenv("HDR_FINISHER_PROOF_ROOT", str(tmp_path))
    monkeypatch.setattr(proofing_module, "_inspect_artifact", lambda *_: (1.0, "metadata"))
    pixels = np.full((180, 130, 3), .18, np.float32)
    adjustments = AdjustmentState()
    session = SimpleNamespace(session_id="failed-proof", image=pixels,
        render_cache=SessionRenderCache(pixels, None), adjustments=adjustments)
    closed = False
    original_bands = DeliveryFrame.bands
    original_write = DeliveryFrame.write
    storage_class = proofing_module.TemporaryDirectory

    class Backend:
        def export(self, session, settings):
            path = Path(settings.output_path)
            path.write_bytes(b"proof")
            root = settings._proof_endpoint_directory
            endpoints = tuple(DeliveryFrame.spill(root / f"{lane}.rgb", pixels) for lane in ("hdr", "sdr"))
            object.__setattr__(settings, "_proof_endpoints", endpoints)
            return ExportResponse(accepted=True, backend="fake", message="ok", output_path=settings.output_path)

    class Storage(storage_class):
        def cleanup(self):
            assert closed
            super().cleanup()
            raise PermissionError("simulated Windows cleanup failure")

    def track_bands(self, rows):
        nonlocal closed
        try:
            yield from original_bands(self, rows)
        finally:
            closed = True

    def fail_matrix_write(self, bands):
        if self.path.name == "sdr-matrix.rgb":
            next(bands)
            assert not closed
            raise OSError("original disk error")
        original_write(self, bands)

    monkeypatch.setattr(proofing_module, "TemporaryDirectory", Storage)
    monkeypatch.setattr(DeliveryFrame, "bands", track_bands)
    monkeypatch.setattr(DeliveryFrame, "write", fail_matrix_write)
    store = ProofArtifactStore()
    try:
        request = ProofArtifactRequest(adjustments=adjustments, format="avif_gain_map", full_size=True)
        with pytest.raises(OSError, match="original disk error"):
            store.create(session, request, Backend())
        assert not list(store.root.glob("endpoints-*"))
    finally:
        store.clear()
