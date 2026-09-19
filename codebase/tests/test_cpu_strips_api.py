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


def test_strip_execution_refuses_a_graph_it_cannot_reproduce() -> None:
    session_id, adjustments = _session()
    adjustments = json.loads(json.dumps(adjustments))
    adjustments["sdr"]["vignette_section_enabled"] = True
    adjustments["sdr"]["vignette"]["amount"] = -45.0

    response = client.post(
        f"/api/session/{session_id}/preview-raw/sdr",
        json={"adjustments": adjustments, "long_edge": 512, "execution": "strips"},
    )

    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "strip_execution_refused"
    assert "vignette" in body["refusals"]


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
