"""Library RAM grants: estimates decide admission; measured memory is a backstop.

Callbacks run under the scheduler lock and must only enqueue notifications.
No decoder, process sampler or session-store lock is entered while it is held.
"""
from dataclasses import dataclass, field
from threading import RLock, Event
import time
from .library_diagnostics import log

MINIMUM = FAST_BYTES = 64_000_000
FAST_COUNT = 4
FLOOR = 1_000_000_000
STARTING = 1_300_000_000
CLASSES = {"Grade": 0, "now": 1, "soon": 2, "eventually": 3}


def priority_class(priority):
    return "now" if priority < 50 else "soon" if priority < 80 else "eventually"


@dataclass
class Job:
    id: str
    owner: str
    path: str
    kind: str
    estimate: int
    cls: str
    sequence: int
    asked: float
    notify: object = None
    granted: float | None = None
    reason: str = ""
    size_reason: str = ""
    blocked: str = ""
    peak: int | None = None
    baseline: int | None = None
    floor: bool = False
    alone: bool = False
    ready: Event = field(default_factory=Event)

    @property
    def fast(self):
        return self.kind == "quick" and self.estimate <= FAST_BYTES


class Scheduler:
    def __init__(self, ceiling=4_000_000_000, clock=time.monotonic):
        self.lock = RLock()
        self.clock = clock
        self.ceiling = ceiling
        self.jobs = {}
        self.owners = {}
        self.sequence = 0
        self.caches = 0
        self.grade_bytes = 0
        self.grade_name = ""
        self.total = None
        self.available = None
        self.ram = None
        self.pressure = "none"
        self.listeners = set()
        self.sampled_grants = set()

    def update(self, *, caches=0, grade_bytes=0, grade_name="", total=None,
               available=None, ram=None, pressure="none"):
        with self.lock:
            grade_changed = (self.grade_bytes, self.grade_name) != (grade_bytes, grade_name)
            self.caches, self.grade_bytes, self.grade_name = caches, grade_bytes, grade_name
            self.total, self.available, self.ram, self.pressure = total, available, ram, pressure
            self.sampled_grants = {j.id for j in self.jobs.values() if j.granted is not None}
            for job in self.jobs.values():
                if job.granted is not None and total is not None and job.baseline is not None:
                    # Whole-app incremental peak, not private allocation attribution.
                    job.peak = max(job.peak or 0, total-job.baseline)
            self._pump()
            if grade_changed:
                for notify in self.listeners:
                    notify(dict(type="grade", name=grade_name, bytes=grade_bytes))

    def heartbeat(self, owner):
        with self.lock:
            self.owners[owner] = self.clock()

    def expire(self, seconds=15):
        with self.lock:
            for owner, seen in list(self.owners.items()):
                if self.clock()-seen > seconds:
                    self.disconnect(owner)

    def ask(self, id, owner, path, kind, estimate, cls="now", notify=None, size_reason=""):
        if cls not in CLASSES:
            raise ValueError("Unknown Library priority")
        with self.lock:
            if id in self.jobs:
                job = self.jobs[id]
                if job.owner != owner:
                    raise ValueError("Grant belongs to another window")
                return job
            self.sequence += 1
            amount = max(0 if cls == "Grade" else MINIMUM, int(estimate))
            job = Job(id, owner, path, kind, amount, cls,
                      self.sequence, self.clock(), notify)
            job.size_reason = size_reason
            self.jobs[id] = job
            self._log(job, "asked")
            self._pump()
            return job

    def change(self, id, owner, cls):
        if cls not in CLASSES:
            raise ValueError("Unknown Library priority")
        with self.lock:
            job = self.jobs.get(id)
            if job and job.owner == owner:
                job.cls = cls
                self._pump()

    def valid(self, id, path, kind=None):
        with self.lock:
            job = self.jobs.get(id)
            return bool(job and job.path == str(path) and job.granted is not None
                        and (kind is None or job.kind == kind))

    def finish(self, id, owner=None, outcome="finished"):
        with self.lock:
            job = self.jobs.get(id)
            if job is None or (owner is not None and job.owner != owner):
                return
            self.jobs.pop(id)
            self._log(job, outcome)
            job.ready.set()
            self._pump()

    def defer(self, id, reason):
        """A route that cannot proceed gives back RAM without HTTP retries.
        Bounded-route support is phase 3b; those jobs stay waiting, not failed.
        """
        with self.lock:
            job = self.jobs.get(id)
            if job:
                job.granted = None
                job.floor = job.alone = False
                job.ready.clear()
                job.blocked = reason
                self._wait(job, reason)
                self._pump()

    def snapshot(self):
        with self.lock:
            return [dict(self._message(j, "granted" if j.granted is not None else "waiting"),
                         state="running" if j.granted is not None else "waiting",
                         stage=("memory in use by the photo open in Grade" if j.granted is None and j.reason=="paused for Grade" else f"not enough free memory on this computer (needs {j.estimate/1e9:.2f} GB, {(self.available or 0)/1e9:.2f} GB free)" if j.granted is None and j.reason=="system reserve" else "Developing photo")) for j in self.jobs.values()]

    def disconnect(self, owner):
        with self.lock:
            self.owners.pop(owner, None)
            for id in [j.id for j in self.jobs.values() if j.owner == owner]:
                job = self.jobs.pop(id)
                self._log(job, "cancelled")
                job.ready.set()
            self._pump()

    def _message(self, job, type):
        return dict(type=type, id=job.id, path=job.path, reason=job.reason if type=="waiting" else "",
                    estimate=job.estimate, free=self.available, grade=self.grade_name,
                    cls=job.cls)

    def _wait(self, job, reason):
        if reason != job.reason:
            job.reason = reason
            if job.notify:
                job.notify(self._message(job, "waiting"))

    def _pump(self):
        running = [j for j in self.jobs.values() if j.granted is not None]
        room = self.ceiling-STARTING-self.caches-self.grade_bytes
        total_without_grade = None if self.total is None else max(0, self.total-self.grade_bytes)
        reserve = max(2_000_000_000, (self.ram or 0)//10)
        # Charge every new grant against this snapshot's free-memory headroom.
        # Running estimates are not added to measured process memory.
        headroom = None if self.available is None else max(0, self.available-reserve-
            sum(j.estimate for j in running if j.id not in self.sampled_grants))
        now_waiting = False
        for job in sorted((j for j in self.jobs.values() if j.granted is None),
                          key=lambda j: (CLASSES[j.cls], j.sequence)):
            normal = [j for j in running if not j.fast]
            used = sum(j.estimate for j in normal)
            reason = ""
            if job.blocked:
                self._wait(job, job.blocked)
                continue
            if job.cls == "Grade":
                pass
            elif headroom is not None and job.estimate > headroom:
                reason = "system reserve"
            elif job.fast:
                if sum(j.fast for j in running) >= FAST_COUNT:
                    reason = "fast lane full"
            elif job.cls != "now" and (now_waiting or self.pressure != "none" or
                    (total_without_grade is not None and total_without_grade > self.ceiling-600_000_000) or
                    self.grade_bytes > self.ceiling-STARTING):
                reason = "room"
            elif job.cls == "now" and self.grade_bytes and job.estimate > FLOOR and job.estimate > room:
                reason = "paused for Grade"
            elif job.estimate > FLOOR and (self.pressure == "critical" or
                    (total_without_grade is not None and total_without_grade > self.ceiling)):
                reason = "room"
            elif now_waiting or any(j.alone or j.floor for j in normal):
                reason = "room"
            elif job.estimate+used <= room and self.pressure != "critical" and not (total_without_grade is not None and total_without_grade > self.ceiling):
                pass
            elif job.cls == "now" and job.estimate <= FLOOR:
                if normal:
                    reason = "room"
                else:
                    job.floor = True
            elif job.cls == "now" and self.grade_bytes and job.estimate > room:
                reason = "paused for Grade"
            elif not normal and job.estimate > room and job.cls == "now":
                job.alone = True
            else:
                reason = "room"
            if reason:
                self._wait(job, reason)
                if job.cls == "now" and reason not in ("paused for Grade", "system reserve"):
                    now_waiting = True
                continue
            job.granted = self.clock()
            job.baseline = self.total
            running.append(job)
            if headroom is not None:
                headroom -= job.estimate
            self._log(job, "granted")
            job.ready.set()
            if job.notify:
                job.notify(self._message(job, "granted"))

    def _log(self, job, event):
        log("library_grant_"+event, request=job.id, owner=job.owner, path=job.path,
            priority_class=job.cls, estimate_bytes=job.estimate,
            measured_peak_bytes=job.peak, peak_scope="whole-app-increment",
            wait_ms=round(((job.granted if job.granted is not None else self.clock())-job.asked)*1000),
            reason=job.size_reason or job.reason or None, waited_for=job.reason or None, over_estimate=job.peak is not None and job.peak > job.estimate)


from .app_memory import CEILING
scheduler = Scheduler(CEILING)
