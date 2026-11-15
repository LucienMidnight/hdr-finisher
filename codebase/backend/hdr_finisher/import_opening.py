import asyncio
import os
from uuid import uuid4

from fastapi import WebSocket, WebSocketDisconnect

from .desktop_security import secret_matches


def add_opening_routes(app, manager):
    @app.websocket("/api/import-opening")
    async def opening(socket: WebSocket):
        secret = os.environ.get("HDR_FINISHER_DESKTOP_SECRET")
        origin = socket.headers.get("origin")
        if ((secret and not secret_matches(socket.headers.get("x-hdr-finisher-token"), secret))
                or (origin and origin.split("://", 1)[-1] != socket.headers.get("host"))):
            await socket.close(code=1008)
            return
        await socket.accept()
        owner = uuid4().hex
        manager.connect_owner(owner)
        try:
            await socket.send_json({"owner": owner})
            while True:
                command = await asyncio.wait_for(socket.receive_json(), timeout=15)
                if command.get("type") == "retire" and isinstance(command.get("session_id"), str):
                    manager.retire(command["session_id"], command.get("job_id"), owner)
                await socket.send_json({"type": "heartbeat"})
        except (WebSocketDisconnect, asyncio.TimeoutError):
            pass
        finally:
            manager.disconnect_owner(owner)
