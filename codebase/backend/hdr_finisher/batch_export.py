"""Bounded isolated low-priority photo workers sharing serial GPU delivery."""
from base64 import b64decode, b64encode
from copy import deepcopy
from contextlib import ExitStack
from datetime import datetime, timezone
import gc
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from threading import Condition, Lock, Thread
from time import monotonic
from uuid import uuid4
from .config import APP_DATA_DIR
from .diagnostics import action_scope, current_action, log
from .export_presets import ExportPreset, version_destination
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
    def __init__(self, snapshot, record_path=RECORD_PATH, runner=None, *, shared_source=None):
        self.snapshot, self.record_path, self.runner = snapshot, Path(record_path), runner or self._subprocess
        self.shared_source = shared_source
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
        job = {"id":uuid4().hex,"state":"queued","completed":0,"total":len(photos)*len(preset.versions),"results":[],"directory":directory,"estimated_seconds":None,"progress":0.0,"stage":None,"photo_progress":None,
               "active_photo":None,"photo_completed":0,"photo_total":len(preset.versions),"photos":photos,"preset":preset.model_dump(mode="json"),"started":monotonic()}
        job["diagnostic_action"] = current_action() or job["id"]
        with self.condition:
            if self._closing: raise ValueError("The export queue is closing.")
            log("export", "action_started", action=job["diagnostic_action"], operation="batch_export",
                photo_count=len(photos), rendition_count=job["total"])
            self.jobs[job["id"]] = job
            self.condition.notify_all()
        return self.status(job["id"])
    def status(self, identity):
        with self.condition:
            job = self.jobs[identity]
            return deepcopy({k:v for k,v in job.items() if k not in {"photos","preset","started","diagnostic_action"}})
    def control(self, identity, action):
        with self.condition:
            job = self.jobs[identity]
            if job["state"] not in {"finished","cancelled","failed","cancelling"}:
                job["state"] = {"pause":"paused","resume":"queued","cancel":"cancelling"}[action]
                log("export", "batch_control", action=job["diagnostic_action"],
                    route="refused" if action in {"pause", "cancel"} else "cpu", reason="batch_" + action)
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
            per_photo, running, live = {}, set(), {}
            def publish():
                job["results"] = [row for key in sorted(per_photo) for row in per_photo[key]]
                job["completed"] = len(job["results"])
                active = sorted(running)
                job["active_photo"] = job["photos"][active[0] - 1]["path"] if active else None
                job["photo_completed"] = len(per_photo.get(active[0], [])) if active else 0
                photos = len(job["photos"])
                # Finished photos count whole; running ones by their live share.
                finished = sum(1 for key in per_photo if key not in running)
                fraction = (finished + sum(live.get(key, {}).get("fraction", 0.0) for key in running)) / max(1, photos)
                job["progress"] = round(max(job.get("progress") or 0.0, min(1.0, fraction)), 4)
                current = live.get(active[0], {}) if active else {}
                job["stage"] = current.get("label")
                job["photo_progress"] = current.get("fraction", 0.0) if active else None
                from .export_progress import estimate_remaining
                elapsed = monotonic() - job["started"]
                if photos == 1 and current.get("eta_s") is not None:
                    job["estimated_seconds"] = current["eta_s"]
                elif (estimate := estimate_remaining(job["progress"], elapsed)) is not None:
                    job["estimated_seconds"] = estimate
            def one(sequence, photo):
                def progress(results, state=None):
                    with self.condition:
                        per_photo[sequence] = list(results)
                        if state is not None:
                            live[sequence] = state
                        publish()
                try:
                    if self.runner == self._subprocess:
                        with action_scope(job["diagnostic_action"]):
                            results = self._subprocess(photo, preset, job["directory"], sequence, progress, lambda: job["state"] == "cancelling")
                    else:
                        results = self.runner(photo, preset, job["directory"], sequence)
                except Exception as error:
                    results = [{"photo":photo["path"],"version":v.name,"outcome":"failed","reason":str(error)} for v in preset.versions]
                for row in results:
                    outcome = row["outcome"]
                    source = Path(photo.get("source_path") or photo["path"])
                    log("export", "batch_rendition_finished", action=job["diagnostic_action"],
                        photo={"id": str(source), "name": source.name}, version=row["version"],
                        route=row.get("renderer", "refused"), reason="batch_" + outcome)
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
                job["stage"] = None
                if job["state"] == "finished": job["progress"] = 1.0
                log("export", "action_finished", action=job["diagnostic_action"], operation="batch_export",
                    outcome=job["state"], duration_ms=round((monotonic() - job["started"]) * 1000),
                    failed_count=sum(row["outcome"] == "failed" for row in job["results"]))
    @staticmethod
    def _parallel():
        # Each worker peaks at about 1.6 GB on a 42 MP RAW (October 20). With the
        # GPU turn down to ~2.7 s, the workers' CPU stages set the pace: three
        # exported six badminton RAWs in 41 s against 50 s for two; four were no
        # faster. Use one worker below 16 GB or when RAM is unknown.
        try: return max(1, min(4, int(os.environ["HDR_FINISHER_BATCH_PARALLEL"])))
        except (KeyError, ValueError): pass
        from .resource_preflight import detect_memory_resources
        total = detect_memory_resources().total_ram_bytes
        return 3 if total is not None and total >= 16 * 1024 ** 3 else 1
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
            work = {"photo":photo,"preset":preset.model_dump(mode="json"),"directory":directory,"sequence":sequence,"progress":str(progress_file),"cancel":str(cancel_file),"diagnostic_action":current_action()}
            if self.shared_source is not None and not cancelled():
                shared = self.shared_source(photo, Path(temporary))
                if shared is not None:
                    work["shared_source"] = shared
            task.write_text(json.dumps(work), encoding="utf-8")
            env = dict(os.environ)
            env.update(TMPDIR=temporary, TEMP=temporary, TMP=temporary)
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
                            try:
                                state = json.loads(progress_file.read_text(encoding="utf-8"))
                                progress(state["results"], state.get("live"))
                            except (OSError, ValueError, KeyError, TypeError): pass
                self._children.discard(child)
                errors = []
                for line in stderr.splitlines():
                    try:
                        record = json.loads(line)
                    except ValueError:
                        errors.append(line)
                        continue
                    if isinstance(record, dict) and record.get("proc") == "batch_worker":
                        print(line, file=sys.stderr, flush=True)
                    else:
                        errors.append(line)
                stderr = "\n".join(errors)
                if child.returncode:
                    if cancelled():
                        try: return json.loads(progress_file.read_text(encoding="utf-8"))["results"]
                        except (OSError, ValueError, KeyError, TypeError): return []
                    raise RuntimeError(stderr[-2000:] or "Export worker stopped.")
            return json.loads(result.read_text(encoding="utf-8"))

def _log_export_timing(clock, response, photo, export_format, develop_s=0.0):
    """One structured record per export: where its wait went, by lane and stage."""
    if develop_s:
        clock.record_development(develop_s)
    summary = clock.summary()
    source = Path(photo.get("source_path") or photo["path"])
    trace_file = os.environ.get("HDR_FINISHER_EXPORT_STAGE_TRACE_FILE")
    if trace_file and "stage_trace" in summary:
        try:
            line = json.dumps({"pid": os.getpid(), "photo": str(source), "format": export_format,
                               "stage_trace": summary["stage_trace"]}, separators=(",", ":"))
            with Path(trace_file).open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
        except OSError:
            pass
    log("export", "export_timing", photo={"id": str(source), "name": source.name}, format=export_format,
        route=getattr(response, "renderer", None) or "cpu", reason="export_stage_timing",
        outcome="exported" if response.accepted else "failed", encoder_timings_ms=dict(response.timings_ms or {}),
        **summary)
    return summary

class PhotoProgress:
    """One photo's share of the bar: RAW development, then each version.

    Development runs before the photo's size is known, so it shows a
    provisional, time-based share. Once the photo is open the rest of the bar
    continues from wherever development left it, so it never jumps back.
    """
    # Development took 3.8-4.5 s for the 42 MP Sony on the minimum Mac. The
    # share approaches 15% and keeps moving however long development takes.
    DEVELOP_SHARE = 0.15
    DEVELOP_TIME_CONSTANT_S = 3.0

    def __init__(self, versions):
        self.versions = max(1, versions)
        self.export_format = None
        self.started = monotonic()
        self.developed_at = None
        self.base = 0.0
        self.index = 0
        self.clock = None
        self._reported = 0.0
        self._lock = Lock()

    def developed(self, *, first_format=None):
        with self._lock:
            self.base = self._fraction()
            self.export_format = first_format
            self.developed_at = monotonic()

    def begin(self, index, clock, *, export_format=None):
        with self._lock:
            self.index, self.clock = index, clock
            if export_format is not None:
                self.export_format = export_format

    def fraction(self):
        with self._lock:
            return self._fraction()

    def _fraction(self):
        if self.developed_at is None:
            elapsed = monotonic() - self.started
            value = self.DEVELOP_SHARE * (1.0 - math.exp(-elapsed / self.DEVELOP_TIME_CONSTANT_S))
        else:
            live = getattr(self.clock, "progress", None)
            version = live.fraction() if live is not None else 0.0
            value = self.base + (1.0 - self.base) * min(1.0, (self.index + version) / self.versions)
        self._reported = max(self._reported, min(value, .99))
        return self._reported

    def snapshot(self):
        from .export_progress import LABELS, default_render_label, estimate_remaining
        with self._lock:
            fraction = self._fraction()
            live = getattr(self.clock, "progress", None)
            if self.developed_at is None:
                label, eta = LABELS["source"], None
            else:
                label = live.label() if live is not None else default_render_label(self.export_format)
                # Time the rest from the work after development, which the plan weighs.
                rendered = (fraction - self.base) / max(1e-6, 1.0 - self.base)
                eta = estimate_remaining(rendered, monotonic() - self.developed_at)
        return {"fraction": round(fraction, 4), "label": label, "eta_s": eta}


def _decode_settings(document):
    from .color_context import DEFAULT_HDR_REFERENCE_WHITE_NITS
    from .models import RawImportSettings, SourceInterpretationOverride

    if document is None:
        return RawImportSettings(), SourceInterpretationOverride(), DEFAULT_HDR_REFERENCE_WHITE_NITS
    return document.source.raw_import_settings, document.interpretation_override, document.hdr_reference_white_nits


def _raw_decode_recipe(settings):
    """Auto Lensfun ignores the profile and database labels it reports back."""
    if settings.lens.mode != "auto":
        return settings
    return settings.model_copy(update={"lens": settings.lens.model_copy(update={"profile_id": None, "database_version": None})})


def _metadata_bytes(value):
    if isinstance(value, bytes):
        return {"__hdr_finisher_bytes__": b64encode(value).decode("ascii")}
    raise TypeError("Unsupported shared source metadata")


def _restore_metadata_bytes(value):
    if set(value) == {"__hdr_finisher_bytes__"}:
        return b64decode(value["__hdr_finisher_bytes__"], validate=True)
    return value


def share_grade_source(store, photo, directory):
    from .delivery_frames import DeliveryFrame
    from .projects import validate_saved_document
    from .sessions import source_stat_key
    from .source_luminance import describe_source_luminance

    try:
        with store._lock:
            current = store.current()
            if current is None or (decode := current.source_decode) is None:
                return None
            source_path = Path(photo["source_path"])
            resolved = source_path.resolve(strict=True)
            if current.source_path.resolve() != resolved or current.source_path.suffix.lower() != source_path.suffix.lower():
                return None
            document = validate_saved_document(photo["grade"]) if photo.get("grade") else None
            if document is not None and source_path.suffix.lower() != resolved.suffix.lower():
                return None
            raw, override, white = _decode_settings(document)
            original = current.retouch_original
            reference = current.sdr_reference_image
            if (not current.source_fingerprint_sha256 or decode.original() is not original
                    or source_stat_key(resolved) != decode.stat_key or current.source_byte_size != decode.stat_key[2]
                    or (document is not None and document.source.fingerprint_sha256 not in (None, current.source_fingerprint_sha256))
                    or _raw_decode_recipe(raw) != _raw_decode_recipe(current.raw_import_settings) or override != current.interpretation_override
                    or white != current.hdr_reference_white_nits
                    or (_raw_decode_recipe(raw), override, white) != (
                        _raw_decode_recipe(decode.raw_import_settings), decode.interpretation_override, decode.reference_white_nits)):
                return None
            highlights = raw.highlight_reconstruction
            if current.metadata.get("dng_opcode_audit") or (current.metadata.get("raw_input")
                    and highlights.enabled and highlights.method == "edge_colour_v1"):
                return None
            encoded_metadata = json.dumps(current.metadata, default=_metadata_bytes, allow_nan=False)
            if json.loads(encoded_metadata, object_hook=_restore_metadata_bytes) != current.metadata:
                return None
            filename = document.source.filename if document is not None else source_path.name
            source = current.source.model_copy(update={"filename": Path(filename.replace("\\", "/")).name})
            luminance = describe_source_luminance(source, current.metadata, has_authored_sdr=reference is not None)
            descriptor = {
                "source": source.model_dump(mode="json"), "analysis": current.analysis.model_dump(mode="json"),
                "metadata": json.loads(encoded_metadata), "source_luminance": luminance.model_dump(mode="json"),
                "source_fingerprint_sha256": current.source_fingerprint_sha256, "source_byte_size": current.source_byte_size,
                "source_stat_key": decode.stat_key, "raw_import_settings": raw.model_dump(mode="json"),
                "interpretation_override": override.model_dump(mode="json"), "hdr_reference_white_nits": white,
            }

        def handoff(name, pixels):
            target = directory / name
            frame = DeliveryFrame.grade_source_frame(pixels)
            if frame is not None:
                try:
                    os.link(frame.path, target)
                except OSError:
                    frame = None
            if frame is None:
                frame = DeliveryFrame.spill(target, pixels)
            return {"path": str(target), "shape": frame.shape, "dtype": frame.dtype.str}

        descriptor["image"] = handoff("shared_source.rgb", original)
        if reference is not None:
            descriptor["sdr_reference_image"] = handoff("shared_sdr_ref.rgb", reference)
        return descriptor
    except (OSError, ValueError, TypeError):
        return None


def _open_shared_source(shared, source_path, document, maps):
    import numpy as np
    from .delivery_frames import DeliveryFrame
    from .models import HDRAnalysis, RawImportSettings, SourceImageDescriptor, SourceInterpretationOverride, SourceLuminanceDescriptor
    from .sessions import LoadedSession, source_stat_key

    def map_frame(descriptor):
        shape = tuple(descriptor["shape"])
        dtype = np.dtype(descriptor["dtype"])
        path = Path(descriptor["path"])
        if (len(shape) != 3 or shape[-1] != 3 or any(type(size) is not int or size <= 0 for size in shape)
                or dtype != np.float32 or path.stat().st_size != math.prod(shape) * dtype.itemsize):
            raise ValueError("Invalid shared source frame")
        return opened.enter_context(DeliveryFrame(path, shape, dtype).map("r"))

    try:
        with ExitStack() as opened:
            raw, override, white = _decode_settings(document)
            source = SourceImageDescriptor.model_validate(shared["source"])
            fingerprint = shared["source_fingerprint_sha256"]
            stamp = tuple(shared["source_stat_key"])
            if (source_stat_key(source_path) != stamp or shared["source_byte_size"] != stamp[2]
                    or raw != RawImportSettings.model_validate(shared["raw_import_settings"])
                    or override != SourceInterpretationOverride.model_validate(shared["interpretation_override"])
                    or white != shared["hdr_reference_white_nits"]
                    or not isinstance(fingerprint, str) or len(fingerprint) != 64
                    or (document is not None and document.source.fingerprint_sha256 not in (None, fingerprint))):
                return None
            image = map_frame(shared["image"])
            if image.shape != (source.height, source.width, source.channels) or source.dtype != str(image.dtype):
                return None
            reference = map_frame(shared["sdr_reference_image"]) if "sdr_reference_image" in shared else None
            session = LoadedSession(
                session_id=uuid4().hex, source_path=source_path, image=image, sdr_reference_image=reference,
                source=source, analysis=HDRAnalysis.model_validate(shared["analysis"]),
                metadata=json.loads(json.dumps(shared["metadata"]), object_hook=_restore_metadata_bytes),
                hdr_reference_white_nits=white, raw_import_settings=raw, interpretation_override=override,
                source_luminance=SourceLuminanceDescriptor.model_validate(shared["source_luminance"]),
                prepared_fingerprint=fingerprint,
            )
            if source_stat_key(source_path) != stamp:
                return None
            maps.enter_context(opened.pop_all())
            return session
    except (OSError, ValueError, TypeError, KeyError, IndexError):
        return None


def _spill_worker_source(session, scratch, maps, skip=()):
    from .delivery_frames import DeliveryFrame, SOURCE_SPILL_BYTES
    fields = ("image", "sdr_reference_image", "retouch_original")
    sources = {field: pixels for field in fields if (pixels := getattr(session, field)) is not None
               and pixels.nbytes >= SOURCE_SPILL_BYTES and id(pixels) not in skip}
    if not sources:
        return
    directory = Path(scratch.enter_context(tempfile.TemporaryDirectory(prefix="batch-source-")))
    replacements = {}
    for field, source in sources.items():
        key = id(source)
        if key not in replacements:
            frame = DeliveryFrame.spill(directory / f"{field}.rgb", source)
            replacements[key] = maps.enter_context(frame.map("r"))
        setattr(session, field, replacements[key])
    del source, pixels
    sources.clear()
    session.render_cache.image = session.image
    session.render_cache.sdr_reference_image = session.sdr_reference_image
    gc.collect()


def export_photo(photo, preset, directory, sequence, progress=None, cancelled=lambda: False, live=None, *, shared_source=None):
    from .sessions import SessionStore
    from .projects import open_document, validate_saved_document
    from .exporters import build_export_backends
    from .capabilities import probe_capabilities
    from .delivery_frames import batch_source_buffers
    from .export_timing import export_clock
    store = SessionStore(grade_import_parallel=True)
    scratch, maps = ExitStack(), ExitStack()
    results = []
    develop_started = monotonic()
    try:
        from .highlight_edge_gpu import source_work
        source_path = Path(photo["source_path"])
        document = validate_saved_document(photo["grade"]) if photo.get("grade") else None
        skip = ()
        with source_work(priority=20, cancelled=cancelled), batch_source_buffers():
            shared_session = (_open_shared_source(shared_source, source_path.resolve() if document else source_path, document, maps)
                              if shared_source is not None else None)
            if shared_session is not None:
                skip = (id(shared_session.retouch_original), id(shared_session.sdr_reference_image))
                log("export", "batch_source_shared", reason="grade_source_reused", photo={"id": str(source_path), "name": source_path.name})
            if document is not None:
                session = open_document(store, document, source_path, prepared_session=shared_session)
            elif shared_session is not None:
                store.activate_session(shared_session)
                session = shared_session
            else:
                payload = store.create_session(source_path, owns_source_path=False)
                session = store.get(payload.session_id)
            del shared_session
        session.delivery_cancelled = cancelled
        _spill_worker_source(session, scratch, maps, skip)
        session._batch_source_maps = maps
        develop_s = monotonic() - develop_started
        if live is not None: live.developed(first_format=preset.versions[0].settings.format)
        backends = build_export_backends(probe_capabilities())
        original_white = session.hdr_reference_white_nits
        if not photo.get("grade"):
            photo = dict(photo, sdr_only=session.analysis.classification.value == "SDR_ONLY")
        for index, version in enumerate(preset.versions):
            if cancelled(): break
            if live is not None: live.begin(index, None, export_format=version.settings.format)
            row = {"photo":photo["path"],"version":version.name}
            if session.grade_notice:
                row["grade_warning"] = session.grade_notice["reason"]
            if photo.get("sdr_only") and version.settings.format in {"avif_gain_map","jpeg_ultrahdr","jpegxl_hdr"}:
                results.append(dict(row,outcome="skipped",reason="SDR only: no HDR grade."))
                if progress: progress(results)
                continue
            try:
                from .color_context import RenderColorContext
                session.hdr_reference_white_nits = version.reference_white or original_white
                session.color_context = RenderColorContext(session.hdr_reference_white_nits)
                session.render_cache.set_color_context(session.color_context)
                session._release_batch_source_before_encode = index == len(preset.versions) - 1
                target = version_destination(directory, version, photo, sequence, preset.name)
                with tempfile.TemporaryDirectory(prefix=".hdr-export-", dir=target.parent) as staging:
                    staged = Path(staging) / target.name
                    settings = version.settings.model_copy(update={"output_path":str(staged),"overwrite":False,"path_grant":None,"edit_revision":None,"metadata_sequence":sequence})
                    from .delivery import delivery_diagnostics
                    with delivery_diagnostics("export", session.source_path), export_clock() as clock:
                        if live is not None: live.begin(index, clock)
                        response = backends[settings.format].export(session, settings)
                    # RAW development is shared by the versions; the first one carries it.
                    _log_export_timing(clock, response, photo, settings.format, develop_s)
                    develop_s = 0.0
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
    finally:
        try:
            store.clear()
        finally:
            try:
                maps.close()
            finally:
                scratch.close()
    return results
