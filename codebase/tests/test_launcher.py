from __future__ import annotations

import socket
import time
from urllib.request import urlopen

from fastapi import FastAPI
from fastapi.testclient import TestClient

from hdr_finisher.config import APP_VERSION
from hdr_finisher.launcher import LauncherServer, find_available_port, open_server_url, server_url
from hdr_finisher.main import app


def test_server_url_exposes_local_address() -> None:
    assert server_url("127.0.0.1", 8000) == "http://127.0.0.1:8000"


def test_server_url_uses_loopback_for_broad_binding() -> None:
    assert server_url("0.0.0.0", 9123) == "http://127.0.0.1:9123"
    assert server_url("::", 9123) == "http://[::1]:9123"


def test_open_server_url_uses_supplied_browser_opener() -> None:
    opened: list[str] = []

    def opener(url: str) -> bool:
        opened.append(url)
        return True

    assert open_server_url("http://127.0.0.1:8000", opener=opener) is True
    assert opened == ["http://127.0.0.1:8000"]


def test_find_available_port_skips_occupied_preferred_port() -> None:
    with socket.socket() as occupied:
        occupied.bind(("127.0.0.1", 0))
        occupied.listen()
        preferred_port = int(occupied.getsockname()[1])

        selected_port = find_available_port(preferred_port=preferred_port)

    assert selected_port != preferred_port
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", selected_port))


def test_launcher_page_exposes_open_and_copy_controls() -> None:
    response = TestClient(app).get("/launcher")

    assert response.status_code == 200
    assert 'id="server-address"' in response.text
    assert 'id="copy-address"' in response.text
    assert 'href="/">Open HDR Finisher</a>' in response.text
    assert "Chrome, Edge, or Brave" in response.text
    assert "__HDR_FINISHER_VERSION__" not in response.text
    assert f"v{APP_VERSION}" in response.text


def test_launcher_server_starts_and_stops() -> None:
    test_app = FastAPI()

    @test_app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = int(probe.getsockname()[1])

    service = LauncherServer(test_app, port=port)
    service.start()
    try:
        deadline = time.monotonic() + 5.0
        while not service.started and service.running and time.monotonic() < deadline:
            time.sleep(0.02)

        assert service.started is True
        with urlopen(f"{service.url}/health", timeout=2) as response:
            assert response.status == 200
            assert response.read() == b'{"status":"ok"}'
    finally:
        service.stop()

    assert service.running is False
