import asyncio
import threading
import time
from hdr_finisher.instrument_work import InstrumentWork
from hdr_finisher.render_cache import StaleRender

class Request:
    disconnected = False
    async def is_disconnected(self):
        return self.disconnected


def test_superseded_instruments_do_not_build_a_render_backlog():
    async def scenario():
        queue = InstrumentWork(capacity=1)
        entered = threading.Event()
        release = threading.Event()
        calls = []
        def render(current):
            calls.append(current)
            entered.set()
            release.wait(2)
            return 7
        first = asyncio.create_task(queue.run(("photo", "hdr", "overlay"), Request(), render))
        while not entered.is_set():
            await asyncio.sleep(.001)
        pending = [asyncio.create_task(queue.run(("photo", "hdr", "overlay"), Request(), render)) for _ in range(100)]
        await asyncio.sleep(.12)
        assert not calls[0]()
        assert len(calls) == 1  # Waiting requests consume no CPU workers.
        release.set()
        results = await asyncio.gather(first, *pending, return_exceptions=True)
        assert results[-1] == 7
        assert all(isinstance(r, StaleRender) for r in results[:-1])
        assert len(calls) == 2
        assert not queue.lanes
    asyncio.run(scenario())


def test_disconnect_keeps_slot_until_running_work_has_stopped():
    async def scenario():
        queue = InstrumentWork(capacity=1)
        request = Request()
        entered = threading.Event()
        stopped = threading.Event()
        def render(current):
            entered.set()
            while current():
                time.sleep(.005)
            stopped.set()
            raise StaleRender("disconnected")
        task = asyncio.create_task(queue.run("photo", request, render))
        while not entered.is_set():
            await asyncio.sleep(.001)
        request.disconnected = True
        result = await asyncio.gather(task, return_exceptions=True)
        assert isinstance(result[0], StaleRender)
        assert stopped.is_set()
        assert await queue.run("photo", Request(), lambda current: 9) == 9
    asyncio.run(scenario())
