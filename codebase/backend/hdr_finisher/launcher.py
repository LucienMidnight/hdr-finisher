from __future__ import annotations

import os
import json
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

    def __init__(
        self,
        app: Any,
        host: str = DEFAULT_HOST,
        port: int = DEFAULT_PORT,
        *,
        listener: socket.socket | None = None,
        log_level: str = "info",
    ) -> None:
        if listener is not None:
            port = int(listener.getsockname()[1])
        self.url = server_url(host, port)
        self.listener = listener
        config = uvicorn.Config(app, host=host, port=port, log_level=log_level)
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(
            target=self._run,
            name="hdr-finisher-server",
            daemon=True,
        )

    def _run(self) -> None:
        sockets = [self.listener] if self.listener is not None else None
        self.server.run(sockets=sockets)

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
        if self.listener is not None:
            self.listener.close()


def _parent_is_alive(parent_pid: int) -> bool:
    if parent_pid <= 0:
        return False
    if sys.platform == "win32":
        try:
            import ctypes
            from ctypes import wintypes

            process_query_limited_information = 0x1000
            still_active = 259
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            kernel32.OpenProcess.restype = wintypes.HANDLE
            kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
            kernel32.GetExitCodeProcess.restype = wintypes.BOOL
            kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
            handle = kernel32.OpenProcess(process_query_limited_information, False, parent_pid)
            if not handle:
                return False
            try:
                exit_code = wintypes.DWORD()
                return bool(kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))) and exit_code.value == still_active
            finally:
                kernel32.CloseHandle(handle)
        except (AttributeError, OSError):
            return False
    try:
        os.kill(parent_pid, 0)
    except OSError:
        return False
    return True


def run_desktop_sidecar(parent_pid: int) -> None:
    """Run the authenticated backend on an atomically selected loopback port."""
    from .main import app

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind((DEFAULT_HOST, 0))
    listener.listen(2048)
    service = LauncherServer(app, port=0, listener=listener, log_level="warning")
    service.start()
    deadline = time.monotonic() + 20.0
    while not service.started and service.running and time.monotonic() < deadline:
        time.sleep(0.025)
    if not service.started:
        service.stop()
        raise SystemExit("HDR Finisher desktop backend did not start.")

    ready = {
        "event": "ready",
        "protocol_version": 1,
        "backend_version": APP_VERSION,
        "port": int(listener.getsockname()[1]),
        "health_url": f"{service.url}/health",
    }
    print(f"HDR_FINISHER_READY {json.dumps(ready, separators=(',', ':'))}", flush=True)
    try:
        while service.running and _parent_is_alive(parent_pid):
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        service.stop()


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
