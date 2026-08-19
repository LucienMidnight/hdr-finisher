from __future__ import annotations

from pathlib import Path
import json
from io import BytesIO

import pytest
from PIL import Image

from conftest import make_png_bytes
from fastapi.testclient import TestClient

from hdr_finisher.loader import LoaderError
from hdr_finisher.exporters import ExportOverwriteRequired
from hdr_finisher.main import _matches_approved_export_target, app, store
from hdr_finisher.models import ExportResponse, ExportTargetIdentity, HDRAnalysis, HDRClassification, MetadataPayload, SessionPayload, SourceImageDescriptor


client = TestClient(app)


def test_windows_native_overwrite_identity_ignores_cross_runtime_device_id(tmp_path: Path) -> None:
    output = tmp_path / "existing.jpg"
    output.write_bytes(b"existing")
    stat = output.stat()
    approved = ExportTargetIdentity(
        device="electron-reports-a-different-windows-volume-id",
        inode=str(stat.st_ino),
        size=str(stat.st_size),
        modifiedNs=str(stat.st_mtime_ns),
    )

    assert _matches_approved_export_target(output, approved, platform_name="nt") is True
    assert _matches_approved_export_target(output, approved, platform_name="posix") is False
    assert _matches_approved_export_target(
        output,
        approved.model_copy(update={"size": str(stat.st_size + 1)}),
        platform_name="nt",
    ) is False


def test_capabilities_endpoint() -> None:
    response = client.get("/api/capabilities")
    assert response.status_code == 200
    assert "capabilities" in response.json()


def test_upload_creates_session(monkeypatch) -> None:
    def fake_create_session(source_path: Path, **_kwargs):
        source_path.unlink()
        return SessionPayload(
            session_id="abc123",
            source=SourceImageDescriptor(
                filename="fixture.png",
                suffix=".png",
                width=8,
                height=6,
                channels=3,
                dtype="float32",
            ),
            metadata=MetadataPayload(bit_depth="8", color_space="sRGB"),
            analysis=HDRAnalysis(
                classification=HDRClassification.SDR_ONLY,
                peak_linear=0.9,
                peak_stops_above_diffuse_white=0.0,
                badge_message="mock",
            ),
            adjustments={
                "hdr": {"exposure": 0, "highlight_rolloff": 0.25, "shadow_lift": 0, "white_balance_kelvin": 6500, "tint": 0},
                "sdr": {"exposure": 0, "highlight_recovery": 0.25, "shadow": 0, "contrast": 0, "tone_mapper": "aces"},
                "shared": {},
            },
            preview={"long_edge": 1600, "format": "png"},
            capabilities={},
        )

    monkeypatch.setattr("hdr_finisher.main.store.create_session", fake_create_session)
    response = client.post("/api/session", files={"file": ("fixture.png", b"stub", "image/png")})
    assert response.status_code == 200
    assert response.json()["session"]["session_id"] == "abc123"


def test_upload_decode_failure_returns_json_detail(monkeypatch) -> None:
    observed: dict[str, Path] = {}

    def fail_create_session(source_path: Path, **_kwargs):
        observed["source_path"] = source_path
        raise LoaderError("Could not decode TIFF input: invalid floating-point predictor")

    monkeypatch.setattr("hdr_finisher.main.store.create_session", fail_create_session)
    response = client.post("/api/session", files={"file": ("fixture.tif", b"stub", "image/tiff")})

    assert response.status_code == 400
    assert response.json() == {"detail": "Could not decode TIFF input: invalid floating-point predictor"}
    assert not observed["source_path"].exists()


def test_real_png_upload_preview_and_scopes() -> None:
    upload = client.post("/api/session", files={"file": ("fixture.png", make_png_bytes(), "image/png")})
    assert upload.status_code == 200
    upload_payload = upload.json()
    assert upload_payload["session"]["source"]["filename"] == "fixture.png"
    session_id = upload_payload["session"]["session_id"]

    preview = client.post(
        f"/api/session/{session_id}/preview/hdr",
        json={
            "adjustments": {
                "hdr": {"exposure": 0, "highlight_rolloff": 0.25, "shadow_lift": 0, "white_balance_kelvin": 6500, "tint": 0},
                "sdr": {"exposure": 0, "highlight_recovery": 0.25, "shadow": 0, "contrast": 0, "tone_mapper": "aces"},
                "shared": {},
            }
        },
    )
    assert preview.status_code == 200
    assert preview.headers["content-type"] in {"image/png", "image/avif"}

    scopes = client.get(f"/api/session/{session_id}/scopes?kind=hdr")
    assert scopes.status_code == 200
    payload = scopes.json()
    assert payload["preview_kind"] == "hdr"
    assert len(payload["channels"]) == 4
    assert payload["scope_type"] == "reference_nits_histogram"
    assert payload["x_axis"] == "reference_nits_log10"
    assert len(payload["stats"]) >= 3
    assert payload["bin_edges"][-1] == pytest.approx(4000.0, rel=1e-5)

    scopes_1k = client.get(f"/api/session/{session_id}/scopes?kind=hdr&max_nits=1000")
    assert scopes_1k.status_code == 200
    assert scopes_1k.json()["bin_edges"][-1] == pytest.approx(1000.0, rel=1e-5)
    assert all(guide["value"] <= 1000.0 for guide in scopes_1k.json()["guides"])

    scopes_10k = client.get(f"/api/session/{session_id}/scopes?kind=hdr&max_nits=10000")
    assert scopes_10k.status_code == 200
    assert scopes_10k.json()["bin_edges"][-1] == pytest.approx(10000.0, rel=1e-5)
    assert any(guide["value"] == 10000.0 for guide in scopes_10k.json()["guides"])

    unsupported_zoom = client.get(f"/api/session/{session_id}/scopes?kind=hdr&max_nits=6000")
    assert unsupported_zoom.status_code == 422

    waveform = client.get(f"/api/session/{session_id}/scopes?kind=hdr&mode=waveform")
    assert waveform.status_code == 200
    waveform_payload = waveform.json()
    assert waveform_payload["scope_type"] == "reference_nits_waveform"
    assert len(waveform_payload["channels"][0]["grid"]) == 256

    proxy = client.get(f"/api/session/{session_id}/proxy/hdr?long_edge=512")
    assert proxy.status_code == 200
    assert proxy.headers["content-type"] == "application/octet-stream"
    assert int(proxy.headers["x-image-width"]) <= 512
    assert int(proxy.headers["x-bytes-per-row"]) % 256 == 0

    half_proxy = client.get(f"/api/session/{session_id}/proxy/hdr?long_edge=512&format=rgba16f")
    assert half_proxy.headers["x-pixel-format"] == "rgba16float"
    assert len(half_proxy.content) <= len(proxy.content)

    geometry_signature = json.dumps(upload_payload["session"]["adjustments"]["shared"]["geometry"], separators=(",", ":"))
    signed_proxy = client.get(
        f"/api/session/{session_id}/proxy/hdr",
        params={"long_edge": 512, "geometry_signature": geometry_signature},
    )
    assert signed_proxy.status_code == 200
    assert signed_proxy.headers["x-geometry-signature"] == geometry_signature
    stale_proxy = client.get(
        f"/api/session/{session_id}/proxy/hdr",
        params={"long_edge": 512, "geometry_signature": '{"rotation":90}'},
    )
    assert stale_proxy.status_code == 409
    assert stale_proxy.json()["detail"] == "Stale geometry proxy request dropped."

    draft_adjustments = json.loads(json.dumps(upload_payload["session"]["adjustments"]))
    draft_adjustments["shared"]["geometry"]["rotation"] = 90
    transient_preview = client.post(
        f"/api/session/{session_id}/preview/hdr",
        json={
            "adjustments": draft_adjustments,
            "transient_adjustments": True,
            "edit_revision": store.get(session_id).edit_revision,
            "long_edge": 512,
            "hdr_display": False,
        },
    )
    assert transient_preview.status_code == 200
    assert Image.open(BytesIO(transient_preview.content)).size == (12, 16)
    assert store.get(session_id).adjustments.shared.geometry.rotation == 0

    raw = client.post(
        f"/api/session/{session_id}/preview-raw/sdr",
        json={"adjustments": upload_payload["session"]["adjustments"], "long_edge": 512, "generation": 7},
    )
    assert raw.status_code == 200
    assert raw.headers["x-generation"] == "7"
    assert raw.headers["x-preview-lane"] == "sdr"
    assert len(raw.content) == int(raw.headers["x-image-width"]) * int(raw.headers["x-image-height"]) * 4

    interactive_scope = client.post(
        f"/api/session/{session_id}/scopes?kind=hdr&mode=waveform&bins=128&columns=256&long_edge=768",
        json={
            "adjustments": upload_payload["session"]["adjustments"],
            "generation": 9,
            "tier": "interactive",
            "long_edge": 768,
        },
    )
    assert interactive_scope.status_code == 200
    assert interactive_scope.json()["tier"] == "interactive"
    assert interactive_scope.json()["generation"] == 9
    assert interactive_scope.json()["normalization_peak"] >= 1

    diagnostics = client.get(f"/api/session/{session_id}/diagnostics")
    assert diagnostics.status_code == 200
    assert diagnostics.json()["render_cache"]["managed_bytes"] > 0


def test_interactive_scopes_use_uncommitted_local_adjustments() -> None:
    upload = client.post("/api/session", files={"file": ("scope-local.png", make_png_bytes(), "image/png")})
    assert upload.status_code == 200
    session = upload.json()["session"]
    session_id = session["session_id"]
    local = {
        "id": "scope-draft",
        "name": "Scope draft",
        "mask": {
            "operator": "leaf",
            "leaf": {
                "type": "brush",
                "strokes": [{
                    "points": [{"x": 0.5, "y": 0.5}],
                    "radius": 1.0,
                    "hardness": 1.0,
                    "flow": 1.0,
                    "opacity": 1.0,
                }],
            },
        },
        "hdr_grade": {"exposure": 2.0},
    }
    endpoint = f"/api/session/{session_id}/scopes?kind=hdr&mode=histogram&long_edge=256"
    baseline = client.post(endpoint, json={
        "adjustments": session["adjustments"],
        "edit_revision": 0,
        "tier": "interactive",
        "local_adjustments": [],
    })
    draft = client.post(endpoint, json={
        "adjustments": session["adjustments"],
        "edit_revision": 0,
        "tier": "interactive",
        "local_adjustments": [local],
    })

    assert baseline.status_code == 200
    assert draft.status_code == 200
    assert draft.json()["channels"] != baseline.json()["channels"]
    assert client.get(f"/api/session/{session_id}/edit-state").json()["document"]["local_adjustments"] == []


def test_local_mask_draft_matches_the_same_mask_after_commit() -> None:
    upload = client.post("/api/session", files={"file": ("mask.png", make_png_bytes(), "image/png")})
    assert upload.status_code == 200
    session_id = upload.json()["session"]["session_id"]
    mask = {
        "operator": "leaf",
        "leaf": {
            "type": "brush",
            "strokes": [{
                "points": [{"x": 0.25, "y": 0.5}, {"x": 0.75, "y": 0.5}],
                "radius": 0.08,
                "hardness": 0.7,
                "flow": 1.0,
                "opacity": 1.0,
            }],
        },
    }
    local = {"id": "draft-mask", "name": "Draft mask", "mask": mask}
    created = client.post(
        f"/api/session/{session_id}/edit-commands",
        json={"commands": [{
            "expected_revision": 0,
            "command_type": "create_local",
            "payload": {"local": local},
        }]},
    )
    assert created.status_code == 200
    committed_local = created.json()["document"]["local_adjustments"][0]
    draft_mask = committed_local["mask"]
    draft_mask["leaf"]["mask_shift_edge"] = 0.02
    draft_mask["leaf"]["mask_feather"] = 0.05
    draft_mask["leaf"]["mask_opacity"] = 0.63

    draft = client.post(
        f"/api/session/{session_id}/local-mask/draft-mask/preview",
        json={"mask": draft_mask, "edit_revision": 1, "long_edge": 256},
    )
    assert draft.status_code == 200
    assert draft.headers["x-mask-preview"] == "draft"
    unchanged = client.get(f"/api/session/{session_id}/edit-state")
    assert unchanged.json()["revision"] == 1
    assert unchanged.json()["document"]["local_adjustments"][0]["mask"]["leaf"]["mask_feather"] == 0

    committed_local["mask"] = draft_mask
    updated = client.post(
        f"/api/session/{session_id}/edit-commands",
        json={"commands": [{
            "expected_revision": 1,
            "command_type": "update_local",
            "target_id": "draft-mask",
            "payload": {"local": committed_local},
        }]},
    )
    assert updated.status_code == 200
    settled = client.get(
        f"/api/session/{session_id}/local-mask/draft-mask?long_edge=256&edit_revision=2"
    )
    assert settled.status_code == 200
    assert draft.headers["x-image-width"] == settled.headers["x-image-width"]
    assert draft.headers["x-image-height"] == settled.headers["x-image-height"]
    assert draft.content == settled.content


def test_local_mask_graph_leaves_are_addressable_as_retained_spatial_masks() -> None:
    upload = client.post("/api/session", files={"file": ("mask-graph.png", make_png_bytes(), "image/png")})
    assert upload.status_code == 200
    session_id = upload.json()["session"]["session_id"]
    graph = {
        "operator": "union",
        "children": [
            {
                "operator": "leaf",
                "leaf": {
                    "type": "linear_gradient",
                    "start": {"x": 0.1, "y": 0.5},
                    "end": {"x": 0.9, "y": 0.5},
                    "mask_opacity": 0.25,
                },
            },
            {
                "operator": "leaf",
                "leaf": {
                    "type": "luminance_range",
                    "fade_in_start_ev": -12,
                    "full_start_ev": -8,
                    "full_end_ev": 6,
                    "fade_out_end_ev": 10,
                    "mask_opacity": 0.4,
                },
            },
        ],
    }
    created = client.post(
        f"/api/session/{session_id}/edit-commands",
        json={"commands": [{
            "expected_revision": 0,
            "command_type": "create_local",
            "payload": {"local": {"id": "mask-graph", "name": "Mask graph", "mask": graph}},
        }]},
    )
    assert created.status_code == 200

    first = client.get(
        f"/api/session/{session_id}/local-mask/mask-graph?long_edge=256&edit_revision=1&spatial_only=true&mask_path=0"
    )
    second = client.get(
        f"/api/session/{session_id}/local-mask/mask-graph?long_edge=256&edit_revision=1&spatial_only=true&mask_path=1"
    )
    invalid = client.get(
        f"/api/session/{session_id}/local-mask/mask-graph?long_edge=256&edit_revision=1&spatial_only=true&mask_path=2"
    )

    assert first.status_code == 200 and second.status_code == 200
    assert first.headers["x-mask-path"] == "0" and second.headers["x-mask-path"] == "1"
    assert first.headers["x-mask-content"] == "spatial"
    assert max(first.content) > 64  # Per-leaf opacity remains a GPU influence parameter.
    assert max(second.content) > 102
    assert invalid.status_code == 422


def test_local_luminance_sampling_returns_a_low_precision_scene_ev_range() -> None:
    upload = client.post("/api/session", files={"file": ("luma.png", make_png_bytes(), "image/png")})
    assert upload.status_code == 200
    session_id = upload.json()["session"]["session_id"]
    response = client.post(
        f"/api/session/{session_id}/local-luminance-sample",
        json={
            "points": [{"x": 0.2, "y": 0.5}, {"x": 0.5, "y": 0.5}, {"x": 0.8, "y": 0.5}],
            "edit_revision": 0,
            "long_edge": 512,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["sample_count"] == 3
    assert -24 <= payload["low_ev"] <= payload["center_ev"] <= payload["high_ev"] <= 24
    assert payload["low_ev"] * 4 == pytest.approx(round(payload["low_ev"] * 4))
    assert payload["high_ev"] * 4 == pytest.approx(round(payload["high_ev"] * 4))


def test_geometry_map_returns_bidirectional_source_anchored_editor_coordinates() -> None:
    upload = client.post("/api/session", files={"file": ("geometry-map.png", make_png_bytes(), "image/png")})
    assert upload.status_code == 200
    session = upload.json()["session"]
    adjustments = session["adjustments"]
    adjustments["shared"]["geometry"]["rotation"] = 90

    response = client.post(
        f'/api/session/{session["session_id"]}/geometry-map',
        json={"adjustments": adjustments, "edit_revision": 0, "long_edge": 512},
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["output_to_source"]) == 6
    assert len(payload["source_to_output"]) == 6
    assert payload["output_width"] > 0 and payload["output_height"] > 0
    assert payload["source_to_output"] == pytest.approx([0.0, -1.0, 1.0, 1.0, 0.0, 0.0], abs=2e-6)


def test_clearing_session_removes_owned_upload_temp_file() -> None:
    upload = client.post("/api/session", files={"file": ("owned.png", make_png_bytes(), "image/png")})
    assert upload.status_code == 200
    staged_path = store.current().source_path
    assert staged_path.exists()

    response = client.delete("/api/session/current")
    assert response.status_code == 200
    assert not staged_path.exists()


def test_source_interpretation_preserves_uploaded_filename() -> None:
    upload = client.post("/api/session", files={"file": ("original-name.png", make_png_bytes(), "image/png")})
    assert upload.status_code == 200
    session_id = upload.json()["session"]["session_id"]

    response = client.post(
        f"/api/session/{session_id}/interpretation",
        json={"color_space": "sRGB", "transfer_function": "sRGB"},
    )
    assert response.status_code == 200
    assert response.json()["session"]["source"]["filename"] == "original-name.png"


def test_overlay_endpoint_returns_png_when_enabled() -> None:
    upload = client.post("/api/session", files={"file": ("fixture.png", make_png_bytes(), "image/png")})
    assert upload.status_code == 200
    session_id = upload.json()["session"]["session_id"]

    overlay = client.post(
        f"/api/session/{session_id}/overlay/sdr",
        json={
            "adjustments": {
                "hdr": {"exposure": 0, "highlight_rolloff": 0.25, "shadow_lift": 0, "white_balance_kelvin": 6500, "tint": 0},
                "sdr": {"exposure": 0, "highlight_recovery": 0.25, "shadow": 0, "contrast": 0, "tone_mapper": "aces"},
                "shared": {
                    "overlay_mode": "zebra",
                    "overlay_opacity": 0.72,
                    "overlay_threshold": 20.0,
                },
            }
        },
    )
    assert overlay.status_code == 200
    assert overlay.headers["content-type"] == "image/png"


def test_real_exr_upload_preview_and_scopes() -> None:
    exr_path = Path(__file__).resolve().parent / "fixtures" / "linear_unconfirmed.exr"
    upload = client.post(
        "/api/session",
        files={"file": ("linear_unconfirmed.exr", exr_path.read_bytes(), "image/x-exr")},
    )
    assert upload.status_code == 200
    payload = upload.json()
    session_id = payload["session"]["session_id"]
    assert payload["session"]["source"]["suffix"] == ".exr"
    assert payload["session"]["analysis"]["classification"] == "HDR_LINEAR_UNCONFIRMED"

    preview = client.post(
        f"/api/session/{session_id}/preview/hdr",
        json={
            "adjustments": {
                "hdr": {"exposure": 0, "highlight_rolloff": 0.25, "shadow_lift": 0, "white_balance_kelvin": 6500, "tint": 0},
                "sdr": {"exposure": 0, "highlight_recovery": 0.25, "shadow": 0, "contrast": 0, "tone_mapper": "aces"},
                "shared": {},
            }
        },
    )
    assert preview.status_code == 200

    scopes = client.get(f"/api/session/{session_id}/scopes?kind=hdr&mode=waveform")
    assert scopes.status_code == 200
    scope_payload = scopes.json()
    assert scope_payload["scope_type"] == "reference_nits_waveform"


def test_interpretation_endpoint_returns_updated_session(monkeypatch) -> None:
    def fake_update_source_interpretation(session_id, override):
        _ = session_id
        _ = override

        class FakeSession:
            def to_payload(self):
                return SessionPayload(
                    session_id="override123",
                    source=SourceImageDescriptor(
                        filename="fixture.hdr",
                        suffix=".hdr",
                        width=18,
                        height=12,
                        channels=3,
                        dtype="float32",
                        source_color_space="ACEScg",
                        transfer_function="LINEAR",
                    ),
                    metadata=MetadataPayload(bit_depth="32f", color_space="ACEScg", transfer_function="LINEAR"),
                    analysis=HDRAnalysis(
                        classification=HDRClassification.HDR_LINEAR_UNCONFIRMED,
                        peak_linear=0.8,
                        peak_stops_above_diffuse_white=2.0,
                        needs_color_override=False,
                        badge_message="override applied",
                    ),
                    adjustments={
                        "hdr": {"exposure": 0, "highlight_rolloff": 0.25, "shadow_lift": 0, "white_balance_kelvin": 6500, "tint": 0},
                        "sdr": {"exposure": 0, "highlight_recovery": 0.25, "shadow": 0, "contrast": 0, "tone_mapper": "aces"},
                        "shared": {},
                    },
                    preview={"long_edge": 1600, "format": "png"},
                    capabilities={},
                )

        return FakeSession()

    monkeypatch.setattr("hdr_finisher.main.store.update_source_interpretation", fake_update_source_interpretation)
    response = client.post("/api/session/override123/interpretation", json={"color_space": "ACEScg", "transfer_function": "LINEAR"})
    assert response.status_code == 200
    assert response.json()["session"]["source"]["source_color_space"] == "ACEScg"


def test_real_exr_interpretation_override_and_auto_reset_preserve_review_state() -> None:
    exr_path = Path(__file__).resolve().parent / "fixtures" / "linear_unconfirmed.exr"
    upload = client.post(
        "/api/session",
        files={"file": ("linear_unconfirmed.exr", exr_path.read_bytes(), "image/x-exr")},
    )
    assert upload.status_code == 200
    session_id = upload.json()["session"]["session_id"]
    assert upload.json()["session"]["analysis"]["needs_color_override"] is True

    manual = client.post(
        f"/api/session/{session_id}/interpretation",
        json={"color_space": "BT.2020", "transfer_function": "LINEAR"},
    )
    assert manual.status_code == 200
    manual_session = manual.json()["session"]
    assert manual_session["source"]["filename"] == "linear_unconfirmed.exr"
    assert manual_session["source"]["interpretation_mode"] == "manual"
    assert manual_session["source"]["color_space_confident"] is True
    assert manual_session["analysis"]["classification"] == "HDR_LINEAR_UNCONFIRMED"
    assert manual_session["analysis"]["needs_color_override"] is True

    automatic = client.post(
        f"/api/session/{session_id}/interpretation",
        json={"color_space": None, "transfer_function": None},
    )
    assert automatic.status_code == 200
    automatic_session = automatic.json()["session"]
    assert automatic_session["source"]["interpretation_mode"] == "auto"
    assert automatic_session["source"]["color_space_confident"] is False
    assert automatic_session["analysis"]["needs_color_override"] is True


def test_transfer_only_api_override_keeps_ambiguous_exr_under_review() -> None:
    exr_path = Path(__file__).resolve().parent / "fixtures" / "linear_unconfirmed.exr"
    upload = client.post(
        "/api/session",
        files={"file": ("linear_unconfirmed.exr", exr_path.read_bytes(), "image/x-exr")},
    )
    session_id = upload.json()["session"]["session_id"]

    response = client.post(
        f"/api/session/{session_id}/interpretation",
        json={"color_space": None, "transfer_function": "LINEAR"},
    )

    assert response.status_code == 200
    session = response.json()["session"]
    assert session["source"]["source_color_space"] is None
    assert session["source"]["color_space_confident"] is False
    assert session["analysis"]["needs_color_override"] is True


def test_export_endpoint_returns_backend_payload(monkeypatch) -> None:
    upload = client.post("/api/session", files={"file": ("fixture.png", make_png_bytes(), "image/png")})
    assert upload.status_code == 200
    session_id = upload.json()["session"]["session_id"]

    class FakeBackend:
        def export(self, session, settings):
            _ = session
            _ = settings
            return ExportResponse(
                accepted=True,
                backend="avif_gain_map",
                message="mock export ok",
                output_path="D:/tmp/mock.avif",
            )

    monkeypatch.setattr("hdr_finisher.main.export_backends", {"avif_gain_map": FakeBackend()})
    response = client.post(f"/api/session/{session_id}/export", json={"format": "avif_gain_map", "quality": 85})
    assert response.status_code == 200
    assert response.json()["backend"] == "avif_gain_map"
    assert response.json()["output_path"].endswith(".avif")


def test_export_endpoint_rejects_unknown_format_before_backend_dispatch() -> None:
    upload = client.post("/api/session", files={"file": ("fixture.png", make_png_bytes(), "image/png")})
    session_id = upload.json()["session"]["session_id"]

    response = client.post(f"/api/session/{session_id}/export", json={"format": "not_a_format"})

    assert response.status_code == 400
    assert response.json()["detail"] == "Unsupported export format: not_a_format"


def test_export_endpoint_requires_explicit_overwrite_confirmation(monkeypatch, tmp_path: Path) -> None:
    upload = client.post("/api/session", files={"file": ("fixture.png", make_png_bytes(), "image/png")})
    session_id = upload.json()["session"]["session_id"]
    output = tmp_path / "existing.jpg"
    output.write_bytes(b"existing")

    class ConflictingBackend:
        def export(self, session, settings):
            _ = session, settings
            raise ExportOverwriteRequired(output)

    monkeypatch.setattr("hdr_finisher.main.export_backends", {"jpeg_ultrahdr": ConflictingBackend()})
    response = client.post(
        f"/api/session/{session_id}/export",
        json={"format": "jpeg_ultrahdr", "output_path": str(output)},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "overwrite_required"
    assert response.json()["detail"]["output_path"] == str(output)


def test_export_endpoint_reports_backend_preflight_rejection(monkeypatch) -> None:
    upload = client.post("/api/session", files={"file": ("fixture.png", make_png_bytes(), "image/png")})
    session_id = upload.json()["session"]["session_id"]

    class RejectingBackend:
        def export(self, session, settings):
            _ = session, settings
            return ExportResponse(
                accepted=False,
                backend="avif_gain_map",
                message="AVIF encoder capability is unavailable",
            )

    monkeypatch.setattr("hdr_finisher.main.export_backends", {"avif_gain_map": RejectingBackend()})
    response = client.post(f"/api/session/{session_id}/export", json={"format": "avif_gain_map"})

    assert response.status_code == 501
    assert response.json()["accepted"] is False
    assert "capability is unavailable" in response.json()["message"]


def test_export_directory_endpoint_returns_selected_folder(monkeypatch) -> None:
    monkeypatch.setattr("hdr_finisher.main.pick_directory", lambda initial_directory=None: "D:\\Exports")
    response = client.post("/api/export-directory", json={"initial_directory": "D:\\"})
    assert response.status_code == 200
    assert response.json()["directory"] == "D:\\Exports"


def test_export_directory_endpoint_allows_cancel(monkeypatch) -> None:
    monkeypatch.setattr("hdr_finisher.main.pick_directory", lambda initial_directory=None: None)
    response = client.post("/api/export-directory", json={})
    assert response.status_code == 200
    assert response.json()["directory"] is None


def test_default_export_directory_endpoint_creates_and_returns_folder(monkeypatch, tmp_path: Path) -> None:
    expected = tmp_path / "Default Exports"
    monkeypatch.setattr("hdr_finisher.main.EXPORTS_DIR", expected)
    response = client.get("/api/export-directory/default")
    assert response.status_code == 200
    assert Path(response.json()["directory"]) == expected.resolve()
    assert expected.is_dir()


def test_export_directory_browser_lists_subfolders(tmp_path: Path) -> None:
    child = tmp_path / "Child Folder"
    child.mkdir()
    (tmp_path / "not-a-folder.txt").write_text("ignored", encoding="utf-8")

    response = client.get("/api/export-directories", params={"path": str(tmp_path)})

    assert response.status_code == 200
    payload = response.json()
    assert Path(payload["current"]) == tmp_path.resolve()
    assert Path(payload["parent"]) == tmp_path.resolve().parent
    assert payload["entries"] == [
        {"name": "Child Folder", "path": str(child.resolve()), "kind": "directory"},
        {"name": "not-a-folder.txt", "path": str((tmp_path / "not-a-folder.txt").resolve()), "kind": "file"},
    ]


def test_export_directory_browser_rejects_missing_folder(tmp_path: Path) -> None:
    response = client.get("/api/export-directories", params={"path": str(tmp_path / "missing")})
    assert response.status_code == 400
    assert "not available" in response.json()["detail"]
