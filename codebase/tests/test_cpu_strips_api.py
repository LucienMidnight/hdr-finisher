"""Phase 4: the bounded CPU path has to be reachable, and honest when it is not.

``execution="strips"`` is the engineering entry described in PRD Phase 4. It
exists so the bounded path can be measured end to end through the real server
before Full becomes selectable. These tests hold it to two promises: what it
returns is the same picture the shipped route returns, and a graph it cannot
run exactly is answered with a refusal rather than a whole-frame render wearing
the bounded route's name.
"""

from __future__ import annotations

import json

import pytest
from conftest import make_png_bytes
from fastapi.testclient import TestClient

from hdr_finisher.main import app, store

client = TestClient(app)


def _session() -> tuple[str, dict]:
    upload = client.post(
        "/api/session", files={"file": ("strips.png", make_png_bytes(), "image/png")}
    )
    assert upload.status_code == 200
    payload = upload.json()
    return payload["session"]["session_id"], payload["session"]["adjustments"]


def test_strip_execution_returns_the_same_pixels_as_the_whole_frame_route() -> None:
    session_id, adjustments = _session()

    whole = client.post(
        f"/api/session/{session_id}/preview-raw/sdr",
        json={"adjustments": adjustments, "long_edge": 512},
    )
    store.get(session_id).render_cache.clear_adjusted()
    strips = client.post(
        f"/api/session/{session_id}/preview-raw/sdr",
        json={"adjustments": adjustments, "long_edge": 512, "execution": "strips"},
    )

    assert whole.status_code == 200
    assert strips.status_code == 200
    assert strips.content == whole.content
    assert "x-strip-execution" not in {key.lower() for key in whole.headers}

    report = json.loads(strips.headers["x-strip-execution"])
    assert report["strip_count"] >= 1
    assert report["strips_rendered"] == report["strip_count"]
    assert report["planned_transient_bytes"] <= report["budget_bytes"]
    assert report["refusals"] == []
    assert float(strips.headers["x-scope-peak"]) == report["scope_peak_value"]


def test_strip_execution_refuses_a_graph_it_cannot_reproduce() -> None:
    # Vignette used to be the refusal here. It runs strip by strip since the
    # placed stages learned where they sit in the frame, so the refusal this
    # asserts is one that is still true: halation, whose quarter-resolution
    # intermediates have no bounded contract yet.
    session_id, adjustments = _session()
    adjustments = json.loads(json.dumps(adjustments))
    adjustments["sdr"]["film_look_section_enabled"] = True
    adjustments["sdr"]["film_look"]["halation_amount"] = 50.0

    response = client.post(
        f"/api/session/{session_id}/preview-raw/sdr",
        json={"adjustments": adjustments, "long_edge": 512, "execution": "strips"},
    )

    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "strip_execution_refused"
    assert "spatial film effects" in body["refusals"]


def test_the_encoded_preview_route_also_carries_the_report() -> None:
    session_id, adjustments = _session()

    response = client.post(
        f"/api/session/{session_id}/preview/sdr",
        json={
            "adjustments": adjustments,
            "long_edge": 512,
            "hdr_display": False,
            "execution": "strips",
        },
    )

    assert response.status_code == 200
    report = json.loads(response.headers["x-strip-execution"])
    assert report["passes"], "a bounded render always names the passes it ran"


def test_the_default_route_is_unchanged() -> None:
    """Nothing in the application selects the bounded path yet, by design."""
    from hdr_finisher.models import PreviewRequest

    assert PreviewRequest().execution == "whole"

@pytest.mark.parametrize("execution", ("whole", "strips"))
def test_native_raw_preview_uses_exact_strips_when_only_strips_fit(monkeypatch, execution):
    from io import BytesIO

    from PIL import Image

    from hdr_finisher import main, resource_preflight as preflight

    image = Image.linear_gradient("L").resize((1600, 1050)).convert("RGB")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    upload = client.post(
        "/api/session", files={"file": ("native-strips.png", buffer.getvalue(), "image/png")}
    )
    assert upload.status_code == 200
    session = upload.json()["session"]
    url = f"/api/session/{session['session_id']}/preview-raw/hdr"
    request = {"adjustments": session["adjustments"], "long_edge": 1600}
    mib = 1024**2
    monkeypatch.setattr(main, "FULL_PREVIEW_BASELINE_DIMENSION", 1024)
    monkeypatch.setattr(preflight, "FULL_PREVIEW_BASELINE_DIMENSION", 1024)

    whole = client.post(url, json=request)
    assert whole.status_code == 200
    frame = store.get(session["session_id"])
    frame.render_cache.clear_adjusted()

    request["execution"] = execution
    monkeypatch.setattr(main, "detect_memory_resources", lambda:
        preflight.ResourceSnapshot(8 * preflight.GIB, 2 * preflight.GIB + 365 * mib, "test"))
    bounded = client.post(url, json=request)
    assert bounded.status_code == 200, bounded.text[:300]
    assert bounded.headers["x-image-width"] == "1600"
    assert bounded.content == whole.content
    assert json.loads(bounded.headers["x-strip-execution"])["strip_count"] > 1

    # A graph with spatial Film effects can't take the bounded route.
    request["adjustments"]["hdr"]["film_look_section_enabled"] = True
    request["adjustments"]["hdr"]["film_look"]["halation_amount"] = 50.0
    assert client.post(url, json=request).status_code == 507

    # Whole and striped routes must both refuse when even the bounded
    # output plus its scratch won't fit the same guard.
    request["adjustments"] = session["adjustments"]
    request["adjustments"]["hdr"]["film_look_section_enabled"] = False
    monkeypatch.setattr(main, "detect_memory_resources", lambda:
        preflight.ResourceSnapshot(8 * preflight.GIB, 2 * preflight.GIB + 300 * mib, "test"))
    assert client.post(url, json=request).status_code == 507
