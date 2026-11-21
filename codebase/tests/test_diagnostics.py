import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from hdr_finisher import diagnostics, library_diagnostics


def test_header_reaches_sync_route_and_legacy_lines(capsys):
    app = FastAPI()
    app.add_middleware(diagnostics.RequestAction)

    @app.get("/")
    def read():
        diagnostics.log("denoise", "grain_prepared", scratch_bytes=10, request_body="private")
        library_diagnostics.log("denoise_grain_prepared", action="keep legacy wording")
        return {"action": diagnostics.current_action()}

    client = TestClient(app)
    response = client.get("/", headers={diagnostics.ACTION_HEADER: "seen-by-backend"})
    assert response.json() == {"action": "seen-by-backend"}
    assert client.get("/").json() == {"action": None}
    structured, legacy, unscoped, _ = capsys.readouterr().err.splitlines()
    record = json.loads(structured)
    assert record["action"] == "seen-by-backend"
    assert record["scratch_bytes"] == 10
    assert record["proc"] == "backend"
    assert "private" not in structured
    assert legacy.startswith("[library] denoise_grain_prepared ")
    assert json.loads(legacy.split(" ", 2)[2])["action_id"] == record["action"]
    assert json.loads(unscoped)["seq"] > record["seq"]
    assert json.loads(unscoped)["action"] is None
