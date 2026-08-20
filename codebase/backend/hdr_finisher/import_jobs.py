from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from threading import Event, RLock
import time
from uuid import uuid4

from .media_browser import MediaBrowserStore
from .models import RawImportSettings, SourceInterpretationOverride
from .sessions import SessionStore


TERMINAL_IMPORT_STATES = {"ready", "error", "cancelled"}


@dataclass
class ImportJob:
    job_id: str
    path: Path
    raw_import_settings: RawImportSettings
    replace_session_id: str | None = None
    created_at: float = field(default_factory=time.monotonic)
    state: str = "queued"
    phase: str = "queued"
    phase_label: str = "Waiting to start"
    preview_path: Path | None = None
    session_id: str | None = None
    error: str | None = None
    cancel_event: Event = field(default_factory=Event, repr=False)
    state_lock: RLock = field(default_factory=RLock, repr=False)

    def payload(self) -> dict[str, object]:
        with self.state_lock:
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
    def __init__(self, sessions: SessionStore, browser: MediaBrowserStore, workers: int = 1) -> None:
        self.sessions = sessions
        self.browser = browser
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="hdr-import")
        self._lock = RLock()
        self._jobs: dict[str, ImportJob] = {}
        self._active_job_id: str | None = None

    def start(
        self, path: Path, settings: RawImportSettings, replace_session_id: str | None = None
    ) -> ImportJob:
        job = ImportJob(
            job_id=uuid4().hex,
            path=path,
            raw_import_settings=settings,
            replace_session_id=replace_session_id,
        )
        with self._lock:
            if self._active_job_id is not None:
                previous = self._jobs.get(self._active_job_id)
                if previous is not None:
                    with previous.state_lock:
                        previous_terminal = previous.state in TERMINAL_IMPORT_STATES
                    if not previous_terminal:
                        previous.cancel_event.set()
                        self._set_phase(previous, "cancelled", "cancelled", "Superseded by a newer import")
            self._jobs[job.job_id] = job
            self._active_job_id = job.job_id
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
        with self._lock:
            job = self.get(job_id)
            job.cancel_event.set()
            with job.state_lock:
                terminal = job.state in TERMINAL_IMPORT_STATES
            if not terminal:
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
            if not self._is_current(job):
                return
            suffix = job.path.suffix.lower()
            preview_label = "Decoding AVIF base preview" if suffix == ".avif" else "Preparing source preview"
            self._set_phase(job, "previewing", "previewing", preview_label)
            try:
                preview_path = self.browser.thumbnail(str(job.path), 512, fast_only=True)
            except Exception:
                # Full development can still succeed when a codec has no cheap
                # thumbnail path, so preview extraction is intentionally soft.
                preview_path = None
            with job.state_lock:
                job.preview_path = preview_path
            if not self._is_current(job):
                return
            with job.state_lock:
                job.state = "preview_ready" if job.preview_path is not None else "developing"
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
            interpretation_override = SourceInterpretationOverride()
            if job.replace_session_id is not None:
                interpretation_override = self.sessions.get(job.replace_session_id).interpretation_override.model_copy(deep=True)
            with self.browser.decode_slot():
                session = self.sessions.prepare_session(
                    job.path,
                    original_filename=job.path.name,
                    owns_source_path=False,
                    raw_import_settings=job.raw_import_settings,
                    interpretation_override=interpretation_override,
                    progress=lambda phase, label: self._set_progress_if_current(job, phase, label),
                    cancelled=job.cancel_event.is_set,
                )
            if not self._is_current(job):
                self._set_phase(job, "cancelled", "cancelled", "Import cancelled")
                return
            self._set_phase(job, "developing", "color_conversion", "Finishing color conversion and preview cache")
            with self._lock:
                if not self._is_current_locked(job):
                    self._set_phase(job, "cancelled", "cancelled", "Import cancelled")
                    return
                if job.replace_session_id is None:
                    payload = self.sessions.activate_session(session)
                else:
                    payload = self.sessions.redevelop_session(job.replace_session_id, session)
                with job.state_lock:
                    job.session_id = payload.session_id
                self._set_phase(job, "ready", "ready", "Source ready")
        except Exception as exc:
            if job.cancel_event.is_set():
                self._set_phase(job, "cancelled", "cancelled", "Import cancelled")
            else:
                with job.state_lock:
                    job.error = str(exc).strip() or exc.__class__.__name__
                self._set_phase(job, "error", "error", "Import failed")

    def _set_phase(self, job: ImportJob, state: str, phase: str, label: str) -> None:
        with job.state_lock:
            job.state = state
            job.phase = phase
            job.phase_label = label

    def _is_current(self, job: ImportJob) -> bool:
        with self._lock:
            return self._is_current_locked(job)

    def _is_current_locked(self, job: ImportJob) -> bool:
        return self._active_job_id == job.job_id and not job.cancel_event.is_set()

    def _set_progress_if_current(self, job: ImportJob, phase: str, label: str) -> None:
        with self._lock:
            if not self._is_current_locked(job):
                raise RuntimeError("Import cancelled")
            self._set_phase(job, "developing", phase, label)

    def _prune(self) -> None:
        completed = sorted(
            (
                job for job in self._jobs.values()
                if _job_state(job) in TERMINAL_IMPORT_STATES
            ),
            key=lambda job: job.created_at,
            reverse=True,
        )
        for job in completed[32:]:
            self._jobs.pop(job.job_id, None)


def _job_state(job: ImportJob) -> str:
    with job.state_lock:
        return job.state
