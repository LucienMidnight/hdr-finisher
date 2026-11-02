"""Library RAM grants: estimates decide admission; measured memory is a backstop.

Callbacks run under the scheduler lock and must only enqueue notifications.
No decoder, process sampler or session-store lock is entered while it is held.
"""
from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock, Event
import time
import os
from .library_diagnostics import log

MINIMUM = FAST_BYTES = 64_000_000
FAST_COUNT = 4
DEVELOPMENTS = 1 if os.environ.get("HDR_FINISHER_LIBRARY_GPU_DEVELOPMENTS") == "1" else 2
SAVES = 2  # Steve approved the provisional bound in this chat, October 31.
FLOOR = 1_000_000_000
STARTING = 1_300_000_000
# A job that fits an empty app is never refused. When freeing pictures did not
# make room, it lets other photos run and asks again after this cool-down.
RECLAIM_RETRY_SECONDS = 10
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
    gpu_bytes: int = 0
    gpu_unified: bool = False
    bypassed: bool = False
    reclaimed: bool = False
    collected: bool = False
    retry_at: float = float("-inf")
    outcome: str = ""
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
        self.gpu_budget = 0
        self.gpu_external = 0
        self.gpu_paused = False
        self.gpu_draw_room = 0
        self.reclamation = None
        self.reclaim_sequence = 0
        self.drained_at = float("-inf")
        self.sample_started = float("-inf")

    def update(self, *, caches=0, grade_bytes=0, grade_name="", total=None,
               available=None, ram=None, pressure="none", sampled_grants=None, sample_started=None):
        with self.lock:
            grade_changed = (self.grade_bytes, self.grade_name) != (grade_bytes, grade_name)
            self.caches, self.grade_bytes, self.grade_name = caches, grade_bytes, grade_name
            self.total, self.available, self.ram, self.pressure = total, available, ram, pressure
            self.sample_started = self.clock() if sample_started is None else sample_started
            self.sampled_grants = ({j.id for j in self.jobs.values() if j.granted is not None}
                                   if sampled_grants is None else set(sampled_grants))
            for job in self.jobs.values():
                if job.granted is not None and total is not None and job.baseline is not None:
                    # Whole-app incremental peak, not private allocation attribution.
                    job.peak = max(job.peak or 0, total-job.baseline)
            # Only a fresh census after every owner acknowledged eviction can
            # decide that the protected job still cannot fit.
            if (self.reclamation and self.reclamation.get("completed_at") is not None and
                    (self.clock() if sample_started is None else sample_started) >= self.reclamation["completed_at"]):
                job = self.jobs.get(self.reclamation["id"])
                request = self.reclamation
                deficit = max(0, (self.total or 0) + (job.estimate if job else 0) - self.ceiling * 11 // 10)
                if job and deficit and request.get("action") != "collect" and request.get("released", 0) > 0:
                    request["pending"].insert(0, request["owner"])
                if job and deficit and request["pending"]:
                    owner = request["pending"].pop(0)
                    request.update(owner=owner, owners=set() if owner is None else {owner}, bytes=deficit,
                                   backend_done=owner is not None, started=False, completed_at=None, released=0)
                else:
                    if job:
                        if request.get("action") == "collect": job.collected = True
                        else: job.reclaimed = True
                    self.reclamation = None
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

    def update_gpu(self, budget, external=0, paused=False):
        with self.lock:
            self.gpu_budget, self.gpu_external, self.gpu_paused = max(0, int(budget)), max(0, int(external)), bool(paused)
            self._pump()

    def preempt_gpu(self):
        with self.lock:
            for job in self.jobs.values():
                if job.granted is None or not job.gpu_bytes or job.saving:
                    continue
                if not hasattr(job, 'gpu_preempted_at'):
                    job.gpu_preempted_at = self.clock()
                    job.preempt_reason = "Grade or export waited for next Library safe point"
                    if not getattr(job, 'gpu_started', False):
                        job.gpu_bytes = 0
                        if job.notify: job.notify(dict(type='gpu-preempt',id=job.id))

    def _preempt_development_place(self, cls):
        """Give a development place to a photo of a higher priority class.

        Decision 18's safe point: the window stops the job and requeues it
        without spending an attempt. One running development is asked per
        census, and never one that has already been asked.
        """
        limit = CLASSES[cls]
        candidates = [j for j in self.jobs.values()
                      if j.granted is not None and j.development and CLASSES[j.cls] > limit]
        if not candidates:
            return
        job = max(candidates, key=lambda j: (CLASSES[j.cls], j.sequence))
        if hasattr(job, "gpu_preempted_at"):
            return
        job.gpu_preempted_at = self.clock()
        job.preempt_reason = "a higher-priority photo needed the development place"
        log("library_grant_place_preempt", request=job.id, path=job.path,
            priority_class=job.cls, wanted_class=cls)
        if job.notify:
            job.notify(dict(type="gpu-preempt", id=job.id))

    def gpu_reserved(self):
        with self.lock:
            return sum(j.gpu_bytes for j in self.jobs.values() if j.granted is not None and not j.saving)

    def gpu_refine(self, id, amount):
        with self.lock:
            job = self.jobs.get(id)
            if not job or job.granted is None or job.saving or amount > job.gpu_bytes:
                return False
            job.gpu_started = True
            # The header reservation may shrink after decode, never grow while holding RAM.
            if not job.gpu_unified:
                job.gpu_bytes = amount
                self._pump()
            return True

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

    def ask(self, id, owner, path, kind, estimate, cls="now", notify=None, size_reason="", order=None, gpu_bytes=0, gpu_unified=False):
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
            job.gpu_bytes = max(0, int(gpu_bytes))
            job.gpu_unified = bool(gpu_unified)
            if job.gpu_unified: job.estimate += job.gpu_bytes
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
            if job.granted is not None and not job.fast:
                self.drained_at = self.clock()
            if hasattr(job, "gpu_preempted_at"):
                log("library_gpu_priority_release", request=job.id, path=job.path,
                    wait_ms=round((self.clock()-job.gpu_preempted_at)*1000, 3),
                    reason=getattr(job, "preempt_reason", "a higher-priority photo needed the resource"))
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
                if job.granted is not None and not job.fast:
                    self.drained_at = self.clock()
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
            if self.reclamation:
                self.reclamation["pending"] = [o for o in self.reclamation["pending"] if o != owner]
                self.reclaimed(self.reclamation["epoch"], owner)
            for id in [j.id for j in self.jobs.values() if j.owner == owner]:
                job = self.jobs.pop(id)
                if job.granted is not None and not job.fast:
                    self.drained_at = self.clock()
                self._log(job, "cancelled")
                job.ready.set()
            self._pump()

    def _message(self, job, type):
        return dict(type=type, id=job.id, path=job.path, reason=job.reason if type=="waiting" else "",
                    estimate=job.estimate, ceiling=self.ceiling, free=self.available, grade=self.grade_name,
                    cls=job.cls, alone=job.alone, saving=job.saving, kind=job.kind, gpu_bytes=job.gpu_bytes)

    def _wait(self, job, reason):
        if reason != job.reason:
            job.reason = reason
            self._log(job, "waiting")
            if job.notify:
                job.notify(self._message(job, "waiting"))

    def reclamation_request(self):
        with self.lock:
            request = self.reclamation
            if request and not request["started"]:
                request["started"] = True
                return dict(request)

    def reclaimed(self, epoch, owner=None, released=0):
        with self.lock:
            request = self.reclamation
            if request and request["epoch"] == epoch:
                if owner != request["owner"]: return
                request["released"] = max(0, int(released or 0))
                if owner is None: request["backend_done"] = True
                else: request["owners"].discard(owner)
                if request["backend_done"] and not request["owners"]:
                    request["completed_at"] = self.clock()

    def _terminal_memory(self, job):
        job.reason = job.outcome = "needs more memory"
        self.jobs.pop(job.id, None)
        self._log(job, "needs_memory")
        job.ready.set()
        if job.notify:
            job.notify(dict(self._message(job, "needs-memory"), reason=job.reason))

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
        memory_reasons = {"room", "measured memory", "reclaiming memory"}
        waiting = [j for j in self.jobs.values() if j.granted is None and not j.fast and not j.blocked]
        # Normal queuing is not a shortage. Only protect a memory wait after
        # running allocations drain and a census started after their release.
        now = self.clock()
        cooling = {j.id for j in waiting if j.retry_at > now}
        guards = [j for j in waiting if j.reason in memory_reasons and j.id not in cooling and
                  not any(k.cls == j.cls and k.sequence < j.sequence and k.id not in cooling for k in waiting) and
                  not any(not k.fast for k in running) and
                  self.sample_started >= self.drained_at]
        guard = min(guards, key=lambda j: (CLASSES[j.cls], j.sequence), default=None)
        if self.reclamation:
            guard = self.jobs.get(self.reclamation["id"], guard)
        # Background work never starts ahead of a photo on screen that is
        # waiting for room (6.8). A waiting neighbour alone does not stop the
        # pre-warmer, which is what makes the next screen ready.
        blocked_classes = set()
        for job in sorted((j for j in self.jobs.values() if j.granted is None),
                          key=lambda j: (CLASSES[j.cls], not (j.kind == "quick" and j.cls == "now"), j.order, j.sequence)):
            normal = [j for j in running if not j.fast]
            used = sum(j.estimate for j in normal)
            reason = ""
            if self.reclamation and self.reclamation["id"] == job.id:
                self._wait(job, "reclaiming memory")
                blocked_classes.add(CLASSES[job.cls])
                continue
            if job.blocked:
                self._wait(job, job.blocked)
                block = job.blocked not in ("paused for Grade", "system reserve", "needs more memory")
                if block:
                    blocked_classes.add(CLASSES[job.cls])
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
            elif any(cls < CLASSES[job.cls] for cls in blocked_classes):
                reason = "higher priority photo first"
            elif job.cls != "now" and (now_waiting or self.pressure != "none" or
                    (total_without_grade is not None and total_without_grade > self.ceiling-600_000_000) or
                    self.grade_bytes > self.ceiling-STARTING):
                reason = "room"
            elif job.cls == "now" and self.grade_bytes and job.estimate > FLOOR and job.estimate > room:
                reason = "paused for Grade"
            elif job.estimate > FLOOR and (self.pressure == "critical" or
                    (total_without_grade is not None and total_without_grade > self.ceiling)):
                reason = "room"
            elif any(j.alone or j.floor for j in normal):
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
            # Decision 21 widens only the protected, drained turn. New grants
            # still consume physical headroom above, including the fast lane.
            guarded_alone = job is guard and not any(j.cls == job.cls for j in running)
            admission_limit = self.ceiling * 11 // 10 if guarded_alone else self.ceiling
            measured_fits = self.total is None or self.total + unmeasured + job.estimate <= admission_limit
            if not reason and job.cls != "Grade" and not job.fast and not job.floor and not measured_fits:
                reason = "measured memory"
            if (not reason and guard and job is not guard and not job.fast and
                    CLASSES[job.cls] >= CLASSES[guard.cls] and job.cls != "Grade"):
                reason = "oldest waiting photo first"
            if not reason and job.gpu_bytes:
                if self.gpu_paused:
                    reason = "GPU needed by Grade or export"
                elif self.gpu_reserved()+job.gpu_bytes+self.gpu_external+self.gpu_draw_room > self.gpu_budget:
                    reason = "GPU memory"
            if not reason:
                if job.development and any(j.kind == "quick" and j.cls == "now" for j in running):
                    reason = "quick previews first"
                elif job.development and sum(bool(j.saving) for j in running) >= SAVES:
                    reason = "saving places full"
                elif job.development and sum(j.development for j in running) >= DEVELOPMENTS:
                    reason = "development places full"
                    if CLASSES[job.cls] <= CLASSES["soon"]:
                        self._preempt_development_place(job.cls)
                elif job.development and any(j.development and CLASSES[j.cls] < CLASSES[job.cls] for j in running):
                    reason = "visible photos first"
            if reason in ("room", "measured memory") and job.cls == "now":
                # The photo on screen never waits on memory that background work
                # is holding: the lower-class development stops at its safe point
                # and requeues behind the photo on screen (6.8, decision 18).
                self._preempt_development_place(job.cls)
            if reason:
                job.floor = job.alone = False
                self._wait(job, reason)
                if reason not in ("paused for Grade", "system reserve", "needs more memory") and job.cls == "now":
                    blocked_classes.add(CLASSES[job.cls])
                if job.cls == "now" and reason not in ("paused for Grade", "system reserve", "needs more memory"):
                    now_waiting = True
                if reason == "needs more memory":
                    self._terminal_memory(job)
                elif (reason in memory_reasons and job is guard and
                      not any(not j.fast and CLASSES[j.cls] >= CLASSES[job.cls] for j in running) and
                      not any(CLASSES[j.cls] < CLASSES[job.cls] for j in running)):
                    if job.reclaimed and job.estimate > self.ceiling-STARTING:
                        self._terminal_memory(job)
                        guard = None
                        now_waiting = False
                    elif job.reclaimed:
                        # It fits an empty app: keep its place, let other
                        # photos run, and free pictures again after a pause.
                        job.reclaimed = job.collected = False
                        job.retry_at = now+RECLAIM_RETRY_SECONDS
                        self._log(job, "reclaim_retry")
                        guard = None
                        now_waiting = False
                    elif self.reclamation is None:
                        self.reclaim_sequence += 1
                        owners = sorted(set(self.owners)-{"backend"})
                        # A finished upload can still own dead native buffers until
                        # Chromium collects it. Release garbage before evicting caches.
                        collect = bool(owners and self.listeners and not job.collected)
                        if not collect: owners.append(None)
                        owner = owners.pop(0)
                        self.reclamation = dict(id=job.id, epoch=self.reclaim_sequence,
                            action="collect" if collect else "reclaim",
                            owner=owner, owners=set() if owner is None else {owner}, pending=owners,
                            bytes=0 if collect else max(0, (self.total or STARTING+self.caches+self.grade_bytes) + job.estimate - admission_limit),
                            started=False, backend_done=owner is not None)
                        self._log(job, "collecting" if collect else "reclaiming")
                continue
            for older in waiting:
                if older.cls == job.cls and older.sequence < job.sequence and older.reason in memory_reasons:
                    older.bypassed = True
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
            priority_class=job.cls, estimate_bytes=job.estimate, gpu_estimate_bytes=job.gpu_bytes, gpu_unified=job.gpu_unified, saving=job.saving,
            alone=job.alone, floor=job.floor, measured_total_bytes=self.total,
            unmeasured_grant_bytes=sum(j.estimate for j in self.jobs.values() if j.granted is not None and j.id not in self.sampled_grants),
            measured_peak_bytes=job.peak, peak_scope="whole-app-increment",
            wait_ms=round(((job.granted if job.granted is not None else self.clock())-job.asked)*1000),
            reason=job.size_reason or job.reason or None, waited_for=job.reason or None, over_estimate=job.peak is not None and job.peak > job.estimate)


from .app_memory import CEILING
scheduler = Scheduler(CEILING)
