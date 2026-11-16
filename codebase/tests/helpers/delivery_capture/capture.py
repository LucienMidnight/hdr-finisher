"""Save actual finished export inputs without rerendering or changing encoders."""
from contextvars import ContextVar
from hashlib import sha256
import json
from pathlib import Path
import os
import shutil
from tempfile import TemporaryDirectory

import numpy as np


def install():
    from hdr_finisher import exporters
    from hdr_finisher.hdr_ceiling import delivery_ceiling_nits

    destination = Path(os.environ["HDR_FINISHER_TEST_CAPTURE_DIR"])
    destination.mkdir(parents=True, exist_ok=True)
    current = ContextVar("finished_delivery_capture", default=None)
    render = exporters._render_export_branch
    execute = exporters._execute_export

    def capture_branch(session, settings, kind, adjustments):
        pixels = render(session, settings, kind, adjustments)
        folder = current.get()
        if folder is not None:
            np.save(folder / f"{kind.value}.npy", pixels, allow_pickle=False)
            (folder / "metadata.json").write_text(json.dumps({
                "jpegxl_high_fidelity": settings.jpegxl_high_fidelity,
                "reference_white_nits": getattr(session, "hdr_reference_white_nits", 203),
                "ceiling_nits": delivery_ceiling_nits(adjustments),
                "format": settings.format.value if hasattr(settings.format, "value") else settings.format,
            }))
        return pixels

    def capture_export(backend, session, settings, **kwargs):
        with TemporaryDirectory(dir=destination, prefix="pending-") as scratch:
            folder = Path(scratch)
            token = current.set(folder)
            try:
                result = execute(backend, session, settings, **kwargs)
            finally:
                current.reset(token)
            if result.accepted:
                output = Path(result.output_path).resolve()
                metadata_path = folder / "metadata.json"
                metadata = json.loads(metadata_path.read_text())
                metadata.update(output_path=str(output), sha256=sha256(output.read_bytes()).hexdigest(),
                                renderer=result.renderer)
                metadata_path.write_text(json.dumps(metadata))
                target = destination / sha256(str(output).encode()).hexdigest()
                shutil.rmtree(target, ignore_errors=True)
                shutil.copytree(folder, target)
            return result

    exporters._render_export_branch = capture_branch
    exporters._execute_export = capture_export
