from __future__ import annotations

import os
import socket
import sys
import threading
import time
import webbrowser
from collections.abc import Callable
from typing import Any

import uvicorn

from .config import APP_NAME, APP_VERSION, DEFAULT_HOST, DEFAULT_PORT


def server_url(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> str:
    """Return the address a user can open, even when the server binds broadly."""
    if host == "0.0.0.0":
        display_host = "127.0.0.1"
    elif host == "::":
        display_host = "::1"
    else:
        display_host = host
    if ":" in display_host and not display_host.startswith("["):
        display_host = f"[{display_host}]"
    return f"http://{display_host}:{port}"


def find_available_port(
    host: str = DEFAULT_HOST,
    preferred_port: int = DEFAULT_PORT,
    search_count: int = 20,
) -> int:
    """Return the preferred local port or a nearby available alternative."""
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    candidates = range(preferred_port, min(preferred_port + search_count, 65536))
    for candidate in candidates:
        with socket.socket(family, socket.SOCK_STREAM) as probe:
            try:
                probe.bind((host, candidate))
            except OSError:
                continue
            return candidate

    with socket.socket(family, socket.SOCK_STREAM) as probe:
        probe.bind((host, 0))
        return int(probe.getsockname()[1])


def set_console_title() -> None:
    """Give the Windows server window a clear lifecycle instruction."""
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.kernel32.SetConsoleTitleW(f"{APP_NAME} - keep this window open")
    except (AttributeError, OSError):
        pass


def open_server_url(
    url: str,
    opener: Callable[[str], bool] = webbrowser.open_new,
) -> bool:
    """Open the application address in the user's browser."""
    return bool(opener(url))


class LauncherServer:
    """Run Uvicorn beside the native launcher window."""

    def __init__(self, app: Any, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> None:
        self.url = server_url(host, port)
        config = uvicorn.Config(app, host=host, port=port, log_level="info")
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(
            target=self.server.run,
            name="hdr-finisher-server",
            daemon=True,
        )

    @property
    def started(self) -> bool:
        return bool(self.server.started)

    @property
    def running(self) -> bool:
        return self.thread.is_alive()

    def start(self) -> None:
        self.thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self.server.should_exit = True
        if self.thread.is_alive():
            self.thread.join(timeout=timeout)


def run() -> None:
    """Start HDR Finisher and present its browser address clearly."""
    from .main import app

    set_console_title()
    port_is_explicit = "HDR_FINISHER_PORT" in os.environ
    port = DEFAULT_PORT if port_is_explicit else find_available_port()
    service = LauncherServer(app, port=port)
    print()
    print("  +--------------------------------------------+")
    print(f"  |  {APP_NAME.upper():<27} v{APP_VERSION:<10}|")
    print("  |  Local HDR finishing and delivery proofing |")
    print("  +--------------------------------------------+")
    print()
    print("  Starting the local server...")
    if port != DEFAULT_PORT:
        print(f"  Port {DEFAULT_PORT} is unavailable; using port {port} instead.")
    service.start()
    try:
        deadline = time.monotonic() + 15.0
        while not service.started and service.running and time.monotonic() < deadline:
            time.sleep(0.05)

        if not service.started:
            print()
            print(f"  Could not start HDR Finisher at {service.url}.")
            print("  The address may already be in use. Close this window and try again.")
            input("\n  Press Enter to close...")
            return

        launcher_url = f"{service.url}/launcher"
        print()
        print("  HDR Finisher is ready.")
        print(f"  Browser address: {service.url}")
        print()
        print("  If the browser does not open, copy the address above and paste it")
        print("  into current Chrome, Edge, or Brave.")
        print("  Keep this window open while using HDR Finisher.")
        print()

        opened = False
        if os.environ.get("HDR_FINISHER_NO_BROWSER") != "1":
            try:
                opened = open_server_url(launcher_url)
            except Exception:
                opened = False
        if not opened:
            print(f"  Launcher page: {launcher_url}")

        while service.running:
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n  Stopping HDR Finisher...")
    finally:
        service.stop()
