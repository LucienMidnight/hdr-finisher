"""One grant channel per window, and condition waits for backend-owned work."""
import asyncio
from contextlib import asynccontextmanager
import os
import inspect
import time
from threading import Event, Thread
from uuid import uuid4
from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from . import app_memory
from .desktop_security import secret_matches
from .library_diagnostics import log
from .library_estimates import estimate_details
from .library_scheduler import scheduler, priority_class
from .resource_preflight import detect_memory_resources


class Runtime:
    def __init__(self, store=None):
        self.store = store
        self.stop = Event()
        self.thread = None
        self.measurement_logged = False
        self.reclaim = lambda amount: app_memory.reclaim("shortage", amount)
        self.reclaimer = None

    def sample(self):
        session = self.store.current() if self.store is not None else None
        grade_bytes = self.store._retained_session_bytes() if session is not None else 0
        grade_name = session.source.filename if session is not None else ""
        with scheduler.lock:
            sampled = {j.id for j in scheduler.jobs.values() if j.granted is not None}
        sample_started = time.monotonic()
        try:
            value = app_memory.snapshot(refresh=True)
            total, pressure = value["totalBytes"], value["pressure"]
        except Exception as error:
            total, pressure = None, "none"
            if not self.measurement_logged:
                self.measurement_logged = True
                log("library_memory_unavailable", reason=str(error), action="scheduling continues on estimates")
        resources = detect_memory_resources()
        caches = sum(min(v["bytes"],v["limitBytes"]) for v in app_memory.cache_snapshot().values())
        scheduler.update(caches=caches, grade_bytes=grade_bytes, grade_name=grade_name,
            total=total, pressure=pressure, available=resources.available_ram_bytes,
            ram=resources.total_ram_bytes, sampled_grants=sampled, sample_started=sample_started)
        scheduler.expire()
        request = scheduler.reclamation_request()
        if request:
            log("library_reclaim_owner", request=request["id"], epoch=request["epoch"],
                owner=request["owner"] or "backend/helper", needed_bytes=request["bytes"])
            if request["owner"] is not None:
                with scheduler.lock:
                    for notify in scheduler.listeners:
                        notify(dict(type="reclaim", id=request["id"], epoch=request["epoch"],
                                    owner=request["owner"], bytes=request["bytes"]))
                return
            def release():
                try:
                    self.reclaim(request["bytes"])
                    scheduler.reclaimed(request["epoch"])
                except Exception as error:
                    log("library_reclaim_failed", reason=str(error))
            self.reclaimer = Thread(target=release, name="library-reclaim-waiting", daemon=True)
            self.reclaimer.start()

    def start(self):
        # Grade's exact retained source is not a reconstructible cache share.
        app_memory.grade_bytes_provider = self.store._retained_session_bytes if self.store is not None else lambda:0
        def run():
            while not self.stop.is_set():
                try:
                    self.sample()
                except Exception as error:
                    if not self.measurement_logged:
                        self.measurement_logged = True
                        log("library_memory_unavailable", reason=str(error), action="scheduling continues on estimates")
                self.stop.wait(.5)
        self.thread = Thread(target=run, name="library-grants", daemon=True)
        self.thread.start()

    def close(self):
        app_memory.grade_bytes_provider = lambda:0
        self.stop.set()
        if self.thread:
            self.thread.join(timeout=3)
        with scheduler.lock:
            for owner in {job.owner for job in scheduler.jobs.values()}:
                scheduler.disconnect(owner)
            scheduler.update()


@asynccontextmanager
async def backend_grant(path, kind="source", priority=10, token=None, cancelled=lambda:False, edge=2560):
    """Reuse a window's grant; never reserve the same decode a second time."""
    own = token is None
    if own:
        token = uuid4().hex
        amount, reason = await asyncio.to_thread(estimate_details, path, kind, scheduler.ceiling, edge)
        job = scheduler.ask(token, "backend", str(path), kind, amount, priority_class(priority), size_reason=reason)
        try:
            while job.granted is None:
                if job.outcome == "needs more memory" or job.reason == "needs more memory":
                    raise HTTPException(409, f"Needs about {job.estimate/1e9:.1f} GB. Raise Memory the app may use in Settings.")
                stopped = await cancelled() if inspect.iscoroutinefunction(cancelled) else cancelled()
                if stopped:
                    raise HTTPException(499, "Library request cancelled.")
                await asyncio.sleep(.05)
        except BaseException:
            scheduler.finish(token, outcome="cancelled")
            raise
    elif not scheduler.valid(token, str(path), kind):
        raise HTTPException(409, "Library grant expired; request it again.")
    outcome = "finished"
    try:
        yield token
    except BaseException as error:
        outcome = "changed" if "chang" in str(error).lower() or "invalidat" in str(error).lower() else "cancelled" if isinstance(error,asyncio.CancelledError) else "finished"
        raise
    finally:
        if own:
            scheduler.finish(token, outcome=outcome)


def add_routes(router, marks):
    @router.websocket("/grants")
    async def grants(socket: WebSocket):
        secret = os.environ.get("HDR_FINISHER_DESKTOP_SECRET")
        if secret and not secret_matches(socket.headers.get("x-hdr-finisher-token"), secret):
            await socket.close(code=1008)
            return
        origin = socket.headers.get("origin")
        if origin and origin.split("://",1)[-1] != socket.headers.get("host"):
            await socket.close(code=1008)
            return
        await socket.accept()
        owner = uuid4().hex
        scheduler.heartbeat(owner)
        loop = asyncio.get_running_loop()
        outgoing = asyncio.Queue()
        def notify(message):
            if message.get("type") == "reclaim" and message.get("owner") != owner:
                return
            loop.call_soon_threadsafe(outgoing.put_nowait, message)
        with scheduler.lock:
            scheduler.listeners.add(notify)
        async def send():
            while True:
                await socket.send_json(await outgoing.get())
        sender = asyncio.create_task(send())
        notify(dict(type="grade",name=scheduler.grade_name,bytes=scheduler.grade_bytes))
        try:
            while True:
                command = await asyncio.wait_for(socket.receive_json(),timeout=15)
                action = command.get("type")
                id = command.get("id", "")
                if action == "heartbeat":
                    scheduler.heartbeat(owner)
                    notify(dict(type="heartbeat"))
                elif action == "visibility":
                    if type(command.get("visible")) is not bool:
                        raise ValueError("Invalid window visibility")
                    scheduler.set_visible(owner, command["visible"])
                elif action == "ask":
                    if not isinstance(id,str) or not 1 <= len(id) <= 96:
                        raise ValueError("Invalid grant identifier")
                    path = str(await asyncio.to_thread(marks.source_path, command["path"]))
                    kind = command.get("kind", "source")
                    if kind not in {"source","cpu","quick","sensor"}:
                        raise ValueError("Invalid Library job")
                    amount, reason = await asyncio.to_thread(estimate_details, path, kind, scheduler.ceiling, int(command.get("edge",2560)))
                    scheduler.ask(id,owner,path,kind,amount,
                        "now" if kind=="quick" and amount>64_000_000 else priority_class(int(command.get("priority",10))),notify,reason,order=command.get("order"), gpu_bytes=max(0,int(command.get("gpu_bytes",0))), gpu_unified=bool(command.get("gpu_unified")))
                elif action == "reclaimed":
                    scheduler.reclaimed(command.get("epoch"), owner)
                elif action == "gpu-done":
                    scheduler.gpu_done(id, owner)
                elif action in {"finish","cancel"}:
                    scheduler.finish(id,owner,command.get("outcome","finished") if action=="finish" else "cancelled")
                elif action == "priority":
                    scheduler.change(id,owner,priority_class(int(command["priority"])),order=command.get("order"))
        except (WebSocketDisconnect,asyncio.TimeoutError):
            pass
        except (KeyError,ValueError,TypeError) as error:
            log("library_grant_channel_invalid",reason=str(error))
            await socket.close(code=1008)
        finally:
            with scheduler.lock:
                scheduler.listeners.discard(notify)
            scheduler.disconnect(owner)
            sender.cancel()
            await asyncio.gather(sender,return_exceptions=True)
