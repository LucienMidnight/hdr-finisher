from types import SimpleNamespace
from pathlib import Path
import json
import os
import subprocess
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient
import numpy as np
from PIL import Image
import pytest

from hdr_finisher import delivery, exporters
from hdr_finisher.models import AdjustmentState, CapabilityInfo, CapabilityStatus, ExportSettings


@pytest.fixture
def policy(tmp_path, monkeypatch):
    monkeypatch.setattr(delivery, "PREFERENCES_PATH", tmp_path / "delivery.json")
    monkeypatch.delenv(delivery.FORCE_CPU_ENV, raising=False)
    return delivery.PREFERENCES_PATH


def test_shared_setting_survives_worker_process(policy):
    delivery.save_preferences(True)
    assert delivery.preferences()["effective_force_cpu"]
    # A fresh worker reads the same preference, without a restart or parent state.
    code = "from hdr_finisher.delivery import preferences; import sys,json; print(json.dumps(preferences(sys.argv[1])))"
    result = subprocess.run([sys.executable, "-c", code, str(policy)], check=True, capture_output=True, text=True,
                            env={**os.environ, "PYTHONPATH": str(Path(delivery.__file__).resolve().parents[1])})
    assert json.loads(result.stdout)["effective_force_cpu"]
    delivery.save_preferences(False)
    assert not delivery.preferences()["effective_force_cpu"]


@pytest.mark.parametrize("value", ["1", "true", "yes", "on"])
def test_environment_override_wins(policy, monkeypatch, value):
    delivery.save_preferences(False)
    monkeypatch.setenv(delivery.FORCE_CPU_ENV, value)
    assert delivery.preferences()["effective_force_cpu"]
    assert delivery.FORCE_CPU_ENV in delivery.renderer_record()["fallback_reason"]


def test_api_persists_strict_boolean(policy):
    app = FastAPI()
    app.include_router(delivery.create_delivery_router())
    with TestClient(app) as client:
        assert not client.get("/api/delivery/preferences").json()["effective_force_cpu"]
        assert client.post("/api/delivery/preferences", json={"force_cpu": "false"}).status_code == 422
        assert client.post("/api/delivery/preferences", json={"force_cpu": True}).json()["effective_force_cpu"]
        assert delivery.renderer_record()["renderer"] == "cpu"
        assert "Performance settings" in delivery.renderer_record()["fallback_reason"]


def test_unreadable_setting_keeps_cpu_available(policy):
    policy.write_text("invalid json", encoding="utf-8")
    assert delivery.renderer_record()["renderer"] == "cpu"
    assert "could not be read" in delivery.renderer_record()["fallback_reason"]


def test_forced_cpu_exports_same_decoded_pixels(policy, tmp_path):
    backend = exporters.SDRPNGExportBackend(CapabilityInfo(name="sdr_png", status=CapabilityStatus.AVAILABLE, detail="fixture"))
    image = np.full((12, 16, 3), .18, dtype=np.float32)
    session = SimpleNamespace(session_id="delivery-fixture", image=image, adjustments=AdjustmentState(), local_adjustments=[], hdr_reference_white_nits=203)
    results = []
    for force_cpu in (False, True):
        delivery.save_preferences(force_cpu)
        result = backend.export(session, ExportSettings(format="sdr_png", output_path=str(tmp_path / f"{force_cpu}.png"), dithering="off"))
        assert result.accepted, result.message
        assert result.renderer == "cpu"
        assert result.fallback_reason
        with Image.open(result.output_path) as decoded:
            results.append(np.asarray(decoded).copy())
    np.testing.assert_array_equal(*results)
