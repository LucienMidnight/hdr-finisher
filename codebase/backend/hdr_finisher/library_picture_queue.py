"""Durable latest-grade picture work; up to PARALLEL_PICTURES items are dispatched."""
from threading import Event, Thread
import time


# Saved-grade pictures made at the same time (see library_worker kept lanes).
PARALLEL_PICTURES = 2

class PictureQueue:
    def __init__(self, kept):
        self.kept=kept; self.marks=kept.marks; self.stop=Event(); self.visible=[]
        with self.marks._lock:
            db=self.marks._connect()
            with db:
                db.execute('CREATE TABLE IF NOT EXISTS picture_jobs (path TEXT PRIMARY KEY, grade_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT \'\')')
            db.close()
        # Pause lasts for this app session only; every launch resumes picture work.
        self.paused=False
        self.completed=0
        if kept.worker is not None: Thread(target=self.run,name='hdr-kept-durable-queue',daemon=True).start()

    def write(self,sql,args=()):
        with self.marks._lock:
            db=self.marks._connect()
            try:
                with db: db.execute(sql,args)
            finally: db.close()

    def enqueue(self,path,grade_id):
        self.write("INSERT INTO picture_jobs(path,grade_id) VALUES (?,?) ON CONFLICT(path) DO UPDATE SET grade_id=excluded.grade_id, reason=''",(path,grade_id))

    def done(self,path,grade_id):
        self.write('DELETE FROM picture_jobs WHERE path=? AND grade_id=?',(path,grade_id))
        self.completed+=1

    def status(self):
        with self.marks._lock: rows=self.marks._query('SELECT path,reason FROM picture_jobs')
        return {'pending':len(rows),'completed':self.completed,'paused':self.paused,
            'failed':[{'path':p,'message':r} for p,r in rows if r], 'running':len(self.kept.jobs)}

    def command(self,request):
        action=request.get('action')
        if action not in (None,'pause','resume'): raise ValueError('Choose Pause or Resume.')
        if action:
            self.paused=action=='pause'
            if self.paused:
                with self.kept._lock:
                    jobs=list(self.kept.jobs.values())
                for job in jobs:
                    if isinstance(job,Event): job.set()
                    else: self.kept.worker.cancel(job)
        if 'paths' in request:
            self.visible=[str(self.marks._path(p)) for p in request['paths']]
            with self.marks._lock:
                pending={row[0] for row in self.marks._query('SELECT path FROM picture_jobs')}
            if pending.intersection(self.visible):
                with self.kept._lock:
                    background=[job for path,job in self.kept.jobs.items() if path not in self.visible and not isinstance(job,Event)]
                for job in background: self.kept.worker.cancel(job)
        return self.status()

    def run(self):
        while not self.stop.wait(.25):
            if self.paused or self.kept._closed: continue
            with self.kept._lock:
                # Two in flight, matching the helper's two saved-picture lanes:
                # one prepares its source while the other renders and encodes.
                if len(self.kept.jobs) >= PARALLEL_PICTURES or self.kept._requested: continue
                running=set(self.kept.jobs)
            with self.marks._lock: rows=self.marks._query('SELECT path,grade_id FROM picture_jobs')
            order={path:index for index,path in enumerate(self.visible)}
            rows=sorted(rows,key=lambda row:order.get(row[0],len(order)))
            for path,grade_id in rows:
                if path in running: continue
                if time.monotonic()<self.kept._retry_after.get(path,0): continue
                try:
                    current=self.kept.request(path)
                    if not current['edited'] or current['grade_identity']!=grade_id or self.kept.cached(path):
                        self.done(path,grade_id); continue
                    self.kept.schedule(path,priority=15 if path in order else 80,_queued=True)
                except Exception as error:
                    self.write('UPDATE picture_jobs SET reason=? WHERE path=?',(str(error),path))
                    self.kept._retry_after[path]=time.monotonic()+30
                break
