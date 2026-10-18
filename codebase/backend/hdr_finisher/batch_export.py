"""One isolated low-priority photo at a time; the exact CPU exporters are unchanged."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from threading import Condition, Thread
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
    def _run(self):
        while True:
            with self.condition:
                self.condition.wait_for(lambda: any(j["state"] in {"queued","cancelling"} for j in self.jobs.values()))
                job = next(j for j in self.jobs.values() if j["state"] in {"queued","cancelling"})
            preset = ExportPreset.model_validate(job["preset"])
            for sequence, photo in enumerate(job["photos"], 1):
                with self.condition:
                    self.condition.wait_for(lambda: job["state"] != "paused")
                    if job["state"] == "cancelling": break
                    job["state"] = "running"
                    job["active_photo"] = photo["path"]
                    previous = list(job["results"])
                    job["photo_completed"] = 0
                def progress(results):
                    with self.condition:
                        job["results"] = previous + results
                        job["completed"] = len(job["results"])
                        job["photo_completed"] = len(results)
                        if job["completed"]:
                            elapsed = monotonic() - job["started"]
                            job["estimated_seconds"] = round(elapsed / job["completed"] * (job["total"] - job["completed"]))
                try:
                    if self.runner == self._subprocess:
                        results = self._subprocess(photo, preset, job["directory"], sequence, progress)
                    else:
                        results = self.runner(photo, preset, job["directory"], sequence)
                except Exception as error:
                    results = [{"photo":photo["path"],"version":v.name,"outcome":"failed","reason":str(error)} for v in preset.versions]
                progress(results)
                with self.condition: job["active_photo"] = None
                try: self._record(photo, preset, results)
                except OSError as error:
                    with self.condition: job["record_warning"] = f"Files completed, but the export record could not be saved: {error}"
            with self.condition:
                job["state"] = "cancelled" if job["state"] == "cancelling" else "finished"
                job["estimated_seconds"] = 0
    def _record(self, photo, preset, results):
        exported = [r for r in results if r["outcome"] in {"exported","renamed"}]
        if not exported: return
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
    def _subprocess(self, photo, preset, directory, sequence, progress=None):
        with tempfile.TemporaryDirectory(prefix="hdr-batch-") as temporary:
            task = Path(temporary) / "task.json"
            result = Path(temporary) / "result.json"
            progress_file = Path(temporary) / "progress.json"
            task.write_text(json.dumps({"photo":photo,"preset":preset.model_dump(mode="json"),"directory":directory,"sequence":sequence,"progress":str(progress_file)}), encoding="utf-8")
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
                while True:
                    try:
                        _, stderr = child.communicate(timeout=.25)
                        break
                    except subprocess.TimeoutExpired:
                        if progress is not None:
                            try: progress(json.loads(progress_file.read_text(encoding="utf-8")))
                            except (OSError, ValueError): pass
                if child.returncode: raise RuntimeError(stderr[-2000:] or "Export worker stopped.")
            return json.loads(result.read_text(encoding="utf-8"))

def export_photo(photo, preset, directory, sequence, progress=None):
    from .sessions import SessionStore
    from .projects import open_document, validate_saved_document
    from .exporters import build_export_backends
    from .capabilities import probe_capabilities
    store = SessionStore(grade_import_parallel=True)
    results = []
    try:
        if photo.get("grade"): session = open_document(store, validate_saved_document(photo["grade"]), Path(photo["source_path"]))
        else:
            payload = store.create_session(Path(photo["source_path"]), owns_source_path=False)
            session = store.get(payload.session_id)
        backends = build_export_backends(probe_capabilities())
        original_white = session.hdr_reference_white_nits
        if not photo.get("grade"):
            photo = dict(photo, sdr_only=session.analysis.classification.value == "SDR_ONLY")
        for version in preset.versions:
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
            except Exception as error: results.append(dict(row,outcome="failed",reason=str(error)))
            if progress: progress(results)
    finally: store.clear()
    return results
