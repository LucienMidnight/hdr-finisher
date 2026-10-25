"""Short-lived source-recipe ownership, before decoding or GPU allocation."""
from threading import RLock
from time import monotonic
from uuid import uuid4

from .library_pictures import picture_key


class SourceJobs:
    def __init__(self):
        self.lock = RLock()
        self.jobs = {}
        self.preparations = {}

    def preparing(self, token, path, function, *args):
        from .library_diagnostics import log
        started = monotonic()
        with self.lock:
            self.preparations[token] = dict(path=str(path), stage="Developing photo", state="running", stage_started=started)
        log("picture_source_preparation_started", path=str(path), job=token)
        try:
            result = function(*args)
            with self.lock: job=dict(self.preparations.get(token,{})); stopping=job.get("state")=="stopping"
            log("picture_source_preparation_cancelled" if stopping else "picture_source_preparation_completed", path=str(path), job=token, duration_ms=(monotonic()-started)*1000, last_stage=job.get("stage"), stage_ms=(monotonic()-job.get("stage_started",started))*1000)
            return result
        except Exception as error:
            with self.lock: job=dict(self.preparations.get(token,{})); stopping=job.get("state")=="stopping"
            log("picture_source_preparation_cancelled" if stopping else "picture_source_preparation_failed", path=str(path), job=token, reason=str(error), duration_ms=(monotonic()-started)*1000, last_stage=job.get("stage"), stage_ms=(monotonic()-job.get("stage_started",started))*1000)
            raise
        finally:
            with self.lock: self.preparations.pop(token, None)

    def cancelled(self, token):
        with self.lock:
            return not any(job["token"]==token for job in self.jobs.values()) or self.preparations.get(token,{}).get("state")=="stopping"

    def stage(self, token, stage, text):
        from .library_diagnostics import log
        now=monotonic()
        with self.lock:
            job=self.preparations.get(token)
            if not job or job["stage"]==text:return
            log("picture_source_preparation_stage", job=token, path=job["path"], stage=stage,
                previous_stage=job["stage"], duration_ms=(now-job.get("stage_started",now))*1000)
            job.update(stage=text,stage_started=now)

    def snapshot(self):
        with self.lock: return [{k:v for k,v in job.items() if k!="stage_started"} for job in self.preparations.values()]

    def claim(self, path, quality, edge, priority, epoch, token=None):
        key = picture_key(path, 100000 if edge == 100000 else 0, quality)
        with self.lock:
            now = monotonic()
            self.jobs = {k: v for k, v in self.jobs.items() if now - v['touched'] < 60}
            if key in self.jobs:
                job = self.jobs[key]
                job['priority'] = min(priority, job['priority'])
                if job.get('promote'): job['promote'](job['priority'])
                return None
            token = token or uuid4().hex
            self.jobs[key] = dict(token=token, key=key, path=path, quality=quality, edge=edge,
                                  priority=priority, epoch=epoch, touched=now)
            return token

    def check(self, token, epoch):
        with self.lock:
            job = next((v for v in self.jobs.values() if v['token'] == token), None)
            if not job or monotonic() - job['touched'] >= 60 or job['epoch'] != epoch or picture_key(job['path'], 100000 if job['edge'] == 100000 else 0, job['quality']) != job['key']:
                raise ValueError('Source preparation expired or was invalidated; request it again.')
            job['touched'] = monotonic()
            return {k:v for k,v in job.items() if k not in {'cancel','promote'}}

    def release(self, token):
        with self.lock:
            if token in self.preparations: self.preparations[token]["state"] = "stopping"
            self.jobs = {k: v for k, v in self.jobs.items() if v['token'] != token}

    def bind(self, token, cancel, promote):
        with self.lock:
            job = next((v for v in self.jobs.values() if v['token'] == token), None)
            if not job:
                cancel()
                return
            job.update(cancel=cancel, promote=promote)
            promote(job['priority'])

    def invalidate(self):
        with self.lock:
            for job in self.jobs.values():
                if job.get('cancel'): job['cancel']()
            for preparation in self.preparations.values(): preparation["state"] = "stopping"
            self.jobs.clear()
