from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event, RLock
import time
from uuid import uuid4

from .media_browser import MediaBrowserStore
from .models import RawImportSettings
from .sessions import SessionStore


TERMINAL_IMPORT_STATES = {"ready", "error", "cancelled"}


@dataclass
class ImportJob:
    job_id: str
    path: Path
    raw_import_settings: RawImportSettings
    created_at: float = field(default_factory=time.monotonic)
    state: str = "queued"
    phase: str = "queued"
    phase_label: str = "Waiting to start"
    preview_path: Path | None = None
    session_id: str | None = None
    error: str | None = None
    cancel_event: Event = field(default_factory=Event, repr=False)

    def payload(self) -> dict[str, object]:
        return {
            "job_id": self.job_id,
            "state": self.state,
            "phase": self.phase,
            "phase_label": self.phase_label,
            "elapsed_ms": int(max(0.0, time.monotonic() - self.created_at) * 1000.0),
            "progress": None,
            "preview_available": self.preview_path is not None,
            "preview_url": f"/api/import-jobs/{self.job_id}/preview" if self.preview_path is not None else None,
            "session_id": self.session_id,
            "error": self.error,
        }


class ImportJobManager:
    def __init__(self, sessions: SessionStore, browser: MediaBrowserStore, workers: int = 2) -> None:
        self.sessions = sessions
        self.browser = browser
        self._executor = ThreadPoolExecutor(max_workers=max(1, min(workers, 2)), thread_name_prefix="hdr-import")
        self._lock = RLock()
        self._jobs: dict[str, ImportJob] = {}

    def start(self, path: Path, settings: RawImportSettings) -> ImportJob:
        job = ImportJob(job_id=uuid4().hex, path=path, raw_import_settings=settings)
        with self._lock:
            self._jobs[job.job_id] = job
            self._prune()
        self._executor.submit(self._run, job)
        return job

    def get(self, job_id: str) -> ImportJob:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            raise KeyError(f"Import job '{job_id}' was not found.")
        return job

    def cancel(self, job_id: str) -> ImportJob:
        job = self.get(job_id)
        job.cancel_event.set()
        if job.state not in TERMINAL_IMPORT_STATES:
            self._set_phase(job, "cancelled", "cancelled", "Import cancelled")
        return job

    def close(self) -> None:
        with self._lock:
            jobs = list(self._jobs.values())
        for job in jobs:
            job.cancel_event.set()
        self._executor.shutdown(wait=False, cancel_futures=True)

    def _run(self, job: ImportJob) -> None:
        try:
            self._set_phase(job, "inspecting", "inspecting", "Reading source metadata")
            if job.cancel_event.is_set():
                return
            try:
                job.preview_path = self.browser.thumbnail(str(job.path), 512)
            except Exception:
                # Full development can still succeed when a codec has no cheap
                # thumbnail path, so preview extraction is intentionally soft.
                job.preview_path = None
            if job.cancel_event.is_set():
                return
            job.state = "preview_ready" if job.preview_path is not None else "developing"
            suffix = job.path.suffix.lower()
            if suffix in {".dng", ".arw", ".cr2", ".cr3", ".nef", ".nrw", ".raf", ".rw2", ".orf", ".ori", ".pef", ".srw"}:
                label = "Developing RAW image"
                phase = "developing_raw"
            elif suffix == ".avif":
                label = "Preparing full-resolution HDR from AVIF"
                phase = "decoding_avif"
            elif suffix == ".jxl":
                label = "Decoding full-resolution JPEG XL"
                phase = "decoding_jpegxl"
            else:
                label = "Decoding full-resolution image"
                phase = "decoding"
            self._set_phase(job, "developing", phase, label)
            with self.browser.decode_slot():
                session = self.sessions.prepare_session(
                    job.path,
                    original_filename=job.path.name,
                    owns_source_path=False,
                    raw_import_settings=job.raw_import_settings,
                    progress=lambda phase, label: self._set_phase(job, "developing", phase, label),
                )
            if job.cancel_event.is_set():
                self._set_phase(job, "cancelled", "cancelled", "Import cancelled")
                return
            self._set_phase(job, "developing", "color_conversion", "Finishing color conversion and preview cache")
            payload = self.sessions.activate_session(session)
            job.session_id = payload.session_id
            self._set_phase(job, "ready", "ready", "Source ready")
        except Exception as exc:
            if job.cancel_event.is_set():
                self._set_phase(job, "cancelled", "cancelled", "Import cancelled")
            else:
                job.error = str(exc).strip() or exc.__class__.__name__
                self._set_phase(job, "error", "error", "Import failed")

    @staticmethod
    def _set_phase(job: ImportJob, state: str, phase: str, label: str) -> None:
        job.state = state
        job.phase = phase
        job.phase_label = label

    def _prune(self) -> None:
        completed = sorted(
            (job for job in self._jobs.values() if job.state in TERMINAL_IMPORT_STATES),
            key=lambda job: job.created_at,
            reverse=True,
        )
        for job in completed[32:]:
            self._jobs.pop(job.job_id, None)
