"""Latest-only editor instruments, with bounded CPU work outside the ASGI loop."""
import asyncio
from threading import Event
from starlette.concurrency import run_in_threadpool
from .render_cache import StaleRender


class InstrumentWork:
    def __init__(self, capacity=2):
        self.slots = asyncio.Semaphore(capacity)
        self.lanes = {}

    async def run(self, key, request, render):
        cancelled = Event()
        previous = self.lanes.get(key)
        if previous is not None:
            previous.set()
        self.lanes[key] = cancelled
        started = False

        def current():
            return not cancelled.is_set()

        async def work():
            nonlocal started
            async with self.slots:
                if not current():
                    raise StaleRender("Superseded instrument request.")
                started = True
                result = await run_in_threadpool(render, current)
                if not current():
                    raise StaleRender("Superseded instrument request.")
                return result

        task = asyncio.create_task(work())
        try:
            while not task.done():
                if not current() or await request.is_disconnected():
                    cancelled.set()
                    if not started:
                        task.cancel()
                        try:
                            await task
                        except asyncio.CancelledError:
                            pass
                        raise StaleRender("Abandoned instrument request.")
                await asyncio.wait({task}, timeout=.05)
            return task.result()
        finally:
            cancelled.set()
            # Keep the slot until a running NumPy operation actually finishes.
            # Cancelling its await would release it while the thread still runs.
            if not task.done():
                if not started:
                    task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            if self.lanes.get(key) is cancelled:
                self.lanes.pop(key, None)
