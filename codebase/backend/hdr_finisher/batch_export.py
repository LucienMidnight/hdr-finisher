"""One isolated low-priority photo at a time, sharing GPU delivery."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from threading import Condition, Lock, Thread
from time import monotonic
from uuid import uuid4
from .config import APP_DATA_DIR
from .export_presets import ExportPreset, ExportVersion, version_destination
from .library_grades import grade_key

RECORD_PATH = APP_DATA_DIR / "export-records.json"

def grade_identity(grade):
    return hashlib.sha256(json.dumps(grade_key(grade), sort_keys=True).encode()).hexdigest()

def read_records(path=RECORD_PATH):
    try: return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError: return {}

def export_state(item_key, grade, records=None):
    if records is None: records = read_records()
    record = records.get(str(item_key))
    return {"exported": bool(record), "edited_since_export": bool(record and record["grade_identity"] != grade_identity(grade)), "last_export": record}

class BatchExports:
    def __init__(self, snapshot, record_path=RECORD_PATH, runner=None):
        self.snapshot, self.record_path, self.runner = snapshot, Path(record_path), runner or self._subprocess
        self.condition, self.jobs = Condition(), {}
        self._closing = False
        self._children = set()
        self._record_lock = Lock()
        self.thread = Thread(target=self._run, daemon=True, name="batch-export")
        self.thread.start()
    def read_records(self): return read_records(self.record_path)
    export_state = staticmethod(export_state)
    def start(self, paths, preset, directory):
        if not paths: raise ValueError("Select photos to export.")
        directory = str(Path(directory).resolve(strict=True))
        photos = [self.snapshot(path) for path in dict.fromkeys(paths)]
        job = {"id":uuid4().hex,"state":"queued","completed":0,"total":len(photos)*len(preset.versions),"results":[],"directory":directory,"estimated_seconds":None,
               "active_photo":None,"photo_completed":0,"photo_total":len(preset.versions),"photos":photos,"preset":preset.model_dump(mode="json"),"started":monotonic()}
        with self.condition:
            self.jobs[job["id"]] = job
            self.condition.notify_all()
        return self.status(job["id"])
    def status(self, identity):
        with self.condition:
            job = self.jobs[identity]
            return deepcopy({k:v for k,v in job.items() if k not in {"photos","preset","started"}})
    def control(self, identity, action):
        with self.condition:
            job = self.jobs[identity]
            if job["state"] not in {"finished","cancelled","failed"}:
                job["state"] = {"pause":"paused","resume":"queued","cancel":"cancelling"}[action]
                self.condition.notify_all()
        return self.status(identity)
    def close(self):
        with self.condition:
            self._closing = True
            for job in self.jobs.values():
                if job["state"] not in {"finished", "cancelled", "failed"}: job["state"] = "cancelling"
            self.condition.notify_all()
        self.thread.join(timeout=3)
        for child in list(self._children):
            if child.poll() is None: child.terminate()
        self.thread.join(timeout=3)

    def _run(self):
        while True:
            with self.condition:
                self.condition.wait_for(lambda: self._closing or any(j["state"] in {"queued","cancelling"} for j in self.jobs.values()))
                if self._closing and not any(j["state"] in {"queued","cancelling"} for j in self.jobs.values()): return
                job = next(j for j in self.jobs.values() if j["state"] in {"queued","cancelling"})
            preset = ExportPreset.model_validate(job["preset"])
            # Real workers overlap: one photo's CPU decode runs while the
            # previous photo is on the GPU (the GPU queue still renders one at
            # a time). Each worker holds one full photo, so memory stays bounded.
            parallel = self._parallel() if self.runner == self._subprocess else 1
            per_photo, running = {}, set()
            def publish():
                job["results"] = [row for key in sorted(per_photo) for row in per_photo[key]]
                job["completed"] = len(job["results"])
                active = sorted(running)
                job["active_photo"] = job["photos"][active[0] - 1]["path"] if active else None
                job["photo_completed"] = len(per_photo.get(active[0], [])) if active else 0
                if job["completed"]:
                    elapsed = monotonic() - job["started"]
                    job["estimated_seconds"] = round(elapsed / job["completed"] * (job["total"] - job["completed"]))
            def one(sequence, photo):
                def progress(results):
                    with self.condition:
                        per_photo[sequence] = list(results)
                        publish()
                try:
                    if self.runner == self._subprocess:
                        results = self._subprocess(photo, preset, job["directory"], sequence, progress, lambda: job["state"] == "cancelling")
                    else:
                        results = self.runner(photo, preset, job["directory"], sequence)
                except Exception as error:
                    results = [{"photo":photo["path"],"version":v.name,"outcome":"failed","reason":str(error)} for v in preset.versions]
                with self.condition:
                    per_photo[sequence] = list(results)
                    running.discard(sequence)
                    publish()
                    self.condition.notify_all()
                try: self._record(photo, preset, results)
                except OSError as error:
                    with self.condition: job["record_warning"] = f"Files completed, but the export record could not be saved: {error}"
            threads = []
            for sequence, photo in enumerate(job["photos"], 1):
                with self.condition:
                    self.condition.wait_for(lambda: job["state"] == "cancelling" or (job["state"] != "paused" and len(running) < parallel))
                    if job["state"] == "cancelling": break
                    job["state"] = "running"
                    running.add(sequence)
                    publish()
                thread = Thread(target=one, args=(sequence, photo), daemon=True, name=f"batch-export-{sequence}")
                threads.append(thread)
                thread.start()
            for thread in threads:
                thread.join()
            with self.condition:
                job["state"] = "cancelled" if job["state"] == "cancelling" else "finished"
                job["estimated_seconds"] = 0
    @staticmethod
    def _parallel():
        # Each worker peaks at about 1.6 GB on a 42 MP RAW (October 20). With the
        # GPU turn down to ~2.7 s, the workers' CPU stages set the pace: three
        # exported six badminton RAWs in 41 s against 50 s for two; four were no
        # faster. Machines under 16 GB keep two.
        try: return max(1, min(4, int(os.environ["HDR_FINISHER_BATCH_PARALLEL"])))
        except (KeyError, ValueError): pass
        from .resource_preflight import detect_memory_resources
        total = detect_memory_resources().total_ram_bytes
        return 3 if total is not None and total >= 16 * 1024 ** 3 else 2
    def _record(self, photo, preset, results):
        exported = [r for r in results if r["outcome"] in {"exported","renamed"}]
        if not exported: return
        with self._record_lock: self._write_record(photo, preset, exported)
    def _write_record(self, photo, preset, exported):
        try: records = json.loads(self.record_path.read_text(encoding="utf-8"))
        except FileNotFoundError: records = {}
        previous = records.get(photo["path"], {})
        history = previous.pop("history", [])
        if previous: history.append(previous)
        records[photo["path"]] = {"history":history,"when":datetime.now(timezone.utc).isoformat(),"preset":preset.name,"grade_identity":grade_identity(photo.get("grade")),"files":exported}
        self.record_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.record_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(records, indent=2), encoding="utf-8")
        os.replace(temporary, self.record_path)
    def _subprocess(self, photo, preset, directory, sequence, progress=None, cancelled=lambda: False):
        with tempfile.TemporaryDirectory(prefix="hdr-batch-") as temporary:
            task = Path(temporary) / "task.json"
            result = Path(temporary) / "result.json"
            progress_file = Path(temporary) / "progress.json"
            cancel_file = Path(temporary) / "cancel"
            task.write_text(json.dumps({"photo":photo,"preset":preset.model_dump(mode="json"),"directory":directory,"sequence":sequence,"progress":str(progress_file),"cancel":str(cancel_file)}), encoding="utf-8")
            env = dict(os.environ)
            # Use the same native-library threading as an ordinary export.
            # Isolation, below-normal priority and serial photos protect Grade.
            thread_limit = env.get("HDR_FINISHER_BATCH_NATIVE_THREADS")
            if thread_limit:
                for name in ("OPENBLAS_NUM_THREADS","OMP_NUM_THREADS","MKL_NUM_THREADS"):
                    env[name] = thread_limit
            env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1])
            flags = (getattr(subprocess,"BELOW_NORMAL_PRIORITY_CLASS",0) | getattr(subprocess,"CREATE_NO_WINDOW",0)) if os.name == "nt" else 0
            command = [sys.executable,"--batch-export-worker",str(task),str(result)] if getattr(sys,"frozen",False) else [sys.executable,"-m","hdr_finisher.batch_export_worker",str(task),str(result)]
            with subprocess.Popen(command, env=env, creationflags=flags, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) as child:
                self._children.add(child)
                while True:
                    if cancelled(): cancel_file.touch()
                    try:
                        _, stderr = child.communicate(timeout=.25)
                        break
                    except subprocess.TimeoutExpired:
                        if progress is not None:
                            try: progress(json.loads(progress_file.read_text(encoding="utf-8")))
                            except (OSError, ValueError): pass
                self._children.discard(child)
                if child.returncode:
                    if cancelled():
                        try: return json.loads(progress_file.read_text(encoding="utf-8"))
                        except (OSError, ValueError): return []
                    raise RuntimeError(stderr[-2000:] or "Export worker stopped.")
            return json.loads(result.read_text(encoding="utf-8"))

def export_photo(photo, preset, directory, sequence, progress=None, cancelled=lambda: False):
    from .sessions import SessionStore
    from .projects import open_document, validate_saved_document
    from .exporters import build_export_backends
    from .capabilities import probe_capabilities
    store = SessionStore(grade_import_parallel=True)
    results = []
    try:
        from .highlight_edge_gpu import source_work
        with source_work(priority=20, cancelled=cancelled):
            if photo.get("grade"): session = open_document(store, validate_saved_document(photo["grade"]), Path(photo["source_path"]))
            else:
                payload = store.create_session(Path(photo["source_path"]), owns_source_path=False)
                session = store.get(payload.session_id)
        session.delivery_cancelled = cancelled
        backends = build_export_backends(probe_capabilities())
        original_white = session.hdr_reference_white_nits
        if not photo.get("grade"):
            photo = dict(photo, sdr_only=session.analysis.classification.value == "SDR_ONLY")
        for version in preset.versions:
            if cancelled(): break
            row = {"photo":photo["path"],"version":version.name}
            if photo.get("sdr_only") and version.settings.format in {"avif_gain_map","jpeg_ultrahdr","jpegxl_hdr"}:
                results.append(dict(row,outcome="skipped",reason="SDR only: no HDR grade."))
                if progress: progress(results)
                continue
            try:
                from .color_context import RenderColorContext
                session.hdr_reference_white_nits = version.reference_white or original_white
                session.color_context = RenderColorContext(session.hdr_reference_white_nits)
                session.render_cache.set_color_context(session.color_context)
                target = version_destination(directory, version, photo, sequence, preset.name)
                with tempfile.TemporaryDirectory(prefix=".hdr-export-", dir=target.parent) as staging:
                    staged = Path(staging) / target.name
                    settings = version.settings.model_copy(update={"output_path":str(staged),"overwrite":False,"path_grant":None,"edit_revision":None})
                    response = backends[settings.format].export(session, settings)
                    if not response.accepted: raise RuntimeError(response.message)
                    if cancelled(): break
                    # Hard links publish a completed file atomically and fail if it exists.
                    candidate, number = target, 1
                    while True:
                        try:
                            if os.name == "nt": os.rename(staged, candidate)
                            else: os.link(staged, candidate)
                            break
                        except FileExistsError:
                            number += 1
                            candidate = target.with_stem(f"{target.stem} ({number})")
                    done = dict(row,outcome="renamed" if number > 1 else "exported",output_path=str(candidate),
                                renderer=response.renderer,fallback_reason=response.fallback_reason)
                    if response.delivery_notes: done["reason"] = " ".join(response.delivery_notes)
                    results.append(done)
            except Exception as error:
                if cancelled(): break
                results.append(dict(row,outcome="failed",reason=str(error)))
            if progress: progress(results)
    finally: store.clear()
    return results
