"""Library RAM grants: estimates decide admission; measured memory is a backstop.

Callbacks run under the scheduler lock and must only enqueue notifications.
No decoder, process sampler or session-store lock is entered while it is held.
"""
from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock, Event
import time
from .library_diagnostics import log

MINIMUM = FAST_BYTES = 64_000_000
FAST_COUNT = 4
DEVELOPMENTS = 2
SAVES = 2  # Steve approved the provisional bound in this chat, October 31.
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
    requested_cls: str = "now"
    order: int = 0
    saving: str = ""
    floor: bool = False
    alone: bool = False
    ready: Event = field(default_factory=Event)

    @property
    def development(self):
        return self.kind in {"source", "cpu"} and self.cls != "Grade" and not self.saving

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
        self.hidden = set()
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
        self.overrun = None
        self.overrun_counts = {}

    def update(self, *, caches=0, grade_bytes=0, grade_name="", total=None,
               available=None, ram=None, pressure="none", sampled_grants=None):
        with self.lock:
            grade_changed = (self.grade_bytes, self.grade_name) != (grade_bytes, grade_name)
            self.caches, self.grade_bytes, self.grade_name = caches, grade_bytes, grade_name
            self.total, self.available, self.ram, self.pressure = total, available, ram, pressure
            self.sampled_grants = ({j.id for j in self.jobs.values() if j.granted is not None}
                                   if sampled_grants is None else set(sampled_grants))
            for job in self.jobs.values():
                if job.granted is not None and total is not None and job.baseline is not None:
                    # Whole-app incremental peak, not private allocation attribution.
                    job.peak = max(job.peak or 0, total-job.baseline)
            self._measure_overrun()
            self._pump()
            if grade_changed:
                for notify in self.listeners:
                    notify(dict(type="grade", name=grade_name, bytes=grade_bytes))

    def _measure_overrun(self):
        """Observe planning-budget excursions; never tune admission estimates."""
        if self.total is None:
            return
        now = self.clock()
        active = [dict(id=j.id, path=j.path, file_type=Path(j.path).suffix.lower(),
                       estimate_bytes=j.estimate, saving=j.saving)
                  for j in self.jobs.values() if j.granted is not None]
        if self.total > self.ceiling:
            if self.overrun is None:
                self.overrun = dict(start=now, peak=self.total, ceiling=self.ceiling,
                                    grants=active, types=set())
                log("library_memory_over_ceiling", measured_total_bytes=self.total,
                    ceiling_bytes=self.ceiling, over_bytes=self.total-self.ceiling,
                    active_grants=active)
            episode = self.overrun
            episode["types"].update(g["file_type"] for g in active if g["file_type"])
            if self.total > episode["peak"]:
                episode.update(peak=self.total, grants=active)
        elif self.overrun is not None:
            episode, self.overrun = self.overrun, None
            fields = dict(peak_bytes=episode["peak"], ceiling_bytes=episode["ceiling"],
                          over_bytes=episode["peak"]-episode["ceiling"],
                          duration_ms=round((now-episode["start"])*1000),
                          active_grants_at_peak=episode["grants"],
                          file_types=sorted(episode["types"]))
            log("library_memory_under_ceiling", **fields)
            for kind in sorted(episode["types"]):
                count = self.overrun_counts[kind] = self.overrun_counts.get(kind, 0)+1
                if count >= 2:
                    log("library_estimate_proposal", file_type=kind, overrun_count=count,
                        action="Steve to review estimate; approved rate unchanged", **fields)

    def set_ceiling(self, ceiling):
        with self.lock:
            self.ceiling = int(ceiling)
            # Unknown dimensions track the current whole budget, not the value
            # captured when this file first asked for a grant.
            for job in self.jobs.values():
                if job.granted is None and job.size_reason == "unknown size":
                    job.estimate = self.ceiling
            self._pump()

    def heartbeat(self, owner):
        with self.lock:
            self.owners[owner] = self.clock()

    def expire(self, seconds=15):
        with self.lock:
            for owner, seen in list(self.owners.items()):
                if self.clock()-seen > seconds:
                    self.disconnect(owner)

    def ask(self, id, owner, path, kind, estimate, cls="now", notify=None, size_reason="", order=None):
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
            job.requested_cls = cls
            if owner in self.hidden and cls != "Grade":
                job.cls = "eventually"
            job.order = job.sequence if order is None else int(order)
            job.size_reason = size_reason
            self.jobs[id] = job
            self._log(job, "asked")
            self._pump()
            return job

    def change(self, id, owner, cls, order=None):
        if cls not in CLASSES:
            raise ValueError("Unknown Library priority")
        with self.lock:
            job = self.jobs.get(id)
            if job and job.owner == owner:
                job.requested_cls = cls
                job.cls = "eventually" if owner in self.hidden and cls != "Grade" else cls
                if order is not None: job.order = int(order)
                self._pump()

    def set_visible(self, owner, visible):
        with self.lock:
            if visible:
                self.hidden.discard(owner)
            else:
                self.hidden.add(owner)
            changed = []
            for job in self.jobs.values():
                if job.owner == owner and job.requested_cls != "Grade":
                    cls = job.requested_cls if visible else "eventually"
                    if cls != job.cls:
                        job.cls = cls
                        changed.append(job)
            self._pump()
            # The waiting reason may stay identical across a visibility change.
            # Still publish the new class to the window's existing channel.
            for job in changed:
                if job.notify:
                    job.notify(self._message(job, "granted" if job.granted is not None else "waiting"))

    def valid(self, id, path, kind=None):
        with self.lock:
            job = self.jobs.get(id)
            return bool(job and job.path == str(path) and job.granted is not None
                        and (kind is None or job.kind == kind))

    def gpu_done(self, id, owner):
        """Free the development place; keep the memory grant through saving."""
        with self.lock:
            job = self.jobs.get(id)
            if job and job.owner == owner and job.granted is not None and job.development:
                job.saving = "waiting"
                self._log(job, "gpu_done")
                self._pump()

    def _start_saves(self):
        active = sum(j.saving == "active" for j in self.jobs.values())
        for job in sorted(self.jobs.values(), key=lambda j: (CLASSES[j.cls], j.order, j.sequence)):
            if active >= SAVES:
                break
            if job.saving == "waiting":
                job.saving = "active"
                active += 1
                self._log(job, "saving")
                if job.notify:
                    job.notify(self._message(job, "saving"))

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
                         stage=(f"Needs about {j.estimate/1e9:.1f} GB. Raise Memory the app may use in Settings." if j.granted is None and j.reason=="needs more memory" else "memory in use by the photo open in Grade" if j.granted is None and j.reason=="paused for Grade" else f"not enough free memory on this computer (needs {j.estimate/1e9:.2f} GB, {(self.available or 0)/1e9:.2f} GB free)" if j.granted is None and j.reason=="system reserve" else "Developing photo")) for j in self.jobs.values()]

    def disconnect(self, owner):
        with self.lock:
            self.owners.pop(owner, None)
            self.hidden.discard(owner)
            for id in [j.id for j in self.jobs.values() if j.owner == owner]:
                job = self.jobs.pop(id)
                self._log(job, "cancelled")
                job.ready.set()
            self._pump()

    def _message(self, job, type):
        return dict(type=type, id=job.id, path=job.path, reason=job.reason if type=="waiting" else "",
                    estimate=job.estimate, ceiling=self.ceiling, free=self.available, grade=self.grade_name,
                    cls=job.cls, alone=job.alone, saving=job.saving)

    def _wait(self, job, reason):
        if reason != job.reason:
            job.reason = reason
            self._log(job, "waiting")
            if job.notify:
                job.notify(self._message(job, "waiting"))

    def _pump(self):
        self._start_saves()
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
                          key=lambda j: (CLASSES[j.cls], not (j.kind == "quick" and j.cls == "now"), j.order, j.sequence)):
            normal = [j for j in running if not j.fast]
            used = sum(j.estimate for j in normal)
            reason = ""
            if job.blocked:
                self._wait(job, job.blocked)
                continue
            if job.cls == "Grade":
                pass
            elif job.estimate > self.ceiling:
                reason = "needs more memory"
            elif headroom is not None and job.estimate > headroom:
                reason = "system reserve"
            elif job.kind == "upkeep" and (self.grade_bytes or any(CLASSES[j.cls] < CLASSES[job.cls] for j in running)
                    or any(j.granted is None and not j.blocked and CLASSES[j.cls] < CLASSES[job.cls]
                           for j in self.jobs.values())):
                reason = "foreground work first"
            elif job.owner in self.hidden and (any(CLASSES[j.cls] < CLASSES[job.cls] for j in running)
                    or any(j.granted is None and not j.blocked and CLASSES[j.cls] < CLASSES[job.cls]
                           and j.reason not in {"paused for Grade", "system reserve"} for j in self.jobs.values())):
                reason = "foreground windows first"
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
            unmeasured = sum(j.estimate for j in running if j.id not in self.sampled_grants)
            measured_fits = self.total is None or self.total + unmeasured + job.estimate <= self.ceiling
            if not reason and job.cls != "Grade" and not job.fast and not job.alone and not job.floor and not measured_fits:
                reason = "measured memory"
            if not reason:
                if job.development and any(j.kind == "quick" and j.cls == "now" for j in running):
                    reason = "quick previews first"
                elif job.development and sum(bool(j.saving) for j in running) >= SAVES:
                    reason = "saving places full"
                elif job.development and sum(j.development for j in running) >= DEVELOPMENTS:
                    reason = "development places full"
                elif job.development and any(j.development and CLASSES[j.cls] < CLASSES[job.cls] for j in running):
                    reason = "visible photos first"
            if reason:
                job.floor = job.alone = False
                self._wait(job, reason)
                if job.cls == "now" and reason not in ("paused for Grade", "system reserve", "needs more memory"):
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
            priority_class=job.cls, estimate_bytes=job.estimate, saving=job.saving,
            alone=job.alone, floor=job.floor, measured_total_bytes=self.total,
            unmeasured_grant_bytes=sum(j.estimate for j in self.jobs.values() if j.granted is not None and j.id not in self.sampled_grants),
            measured_peak_bytes=job.peak, peak_scope="whole-app-increment",
            wait_ms=round(((job.granted if job.granted is not None else self.clock())-job.asked)*1000),
            reason=job.size_reason or job.reason or None, waited_for=job.reason or None, over_estimate=job.peak is not None and job.peak > job.estimate)


from .app_memory import CEILING
scheduler = Scheduler(CEILING)
