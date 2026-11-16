"""Research-only real-codec headroom sweep; never changes codec defaults."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

import numpy as np

from hdr_finisher.capabilities import probe_capabilities
from hdr_finisher.exporters import build_export_backends
from hdr_finisher.hdr_ceiling import decoded_channel_nits, ENCODING_ALLOWANCE
from hdr_finisher.models import AdjustmentState, ExportSettings


def measure(reference, target, mode, format_name, backend, root):
    image = np.broadcast_to(np.linspace(.01, target * .18 / reference * 4, 64,
        dtype=np.float32)[None, :, None], (16, 64, 3)).copy()
    adjustments = AdjustmentState()
    adjustments.hdr.highlight_section_enabled = True
    adjustments.hdr.highlight_compression_mode = mode
    adjustments.hdr.highlight_compression_target_nits = target
    adjustments.hdr.highlight_compression_start_nits = target * .4
    adjustments.hdr.highlight_compression_softness = 60
    session = SimpleNamespace(session_id="floor", image=image, adjustments=adjustments,
        hdr_reference_white_nits=reference, sdr_reference_image=None, local_adjustments=[])
    try:
        result = backend.export(session, ExportSettings(format=format_name, quality=95,
            jpeg_gain_map_scale="full", dithering="off", output_path=str(root / "floor")))
        if not result.accepted:
            return {"accepted": False, "error": result.message}
        peak = float(decoded_channel_nits(Path(result.output_path), format_name).max())
        Path(result.output_path).unlink()
        return {"accepted": True, "peak": peak, "ceiling_passed": peak <= target * (1 + ENCODING_ALLOWANCE)}
    except Exception as error:
        return {"accepted": False, "error": f"{type(error).__name__}: {error}"}


if __name__ == "__main__":
    import sys
    backends = build_export_backends(probe_capabilities())
    records = []
    with TemporaryDirectory(prefix="hdr-headroom-") as scratch:
        for reference in (100, 203):
            for ratio in (() if "--refine" in sys.argv else (1, 1.00001, 1.0001, 1.001, 1.005, 1.01, 1.02, 1.05, 1.1, 1.125, 1.25)):
                for format_name in ("jpeg_ultrahdr", "avif_gain_map", "jpegxl_hdr"):
                    record = {"reference": reference, "ratio": ratio, "target": reference * ratio,
                        "mode": "clip", "format": format_name}
                    record.update(measure(reference, reference * ratio, "clip", format_name,
                        backends[format_name], Path(scratch)))
                    records.append(record)
                    print(json.dumps(record), flush=True)
        candidates = [(reference, target) for reference in (100, 203)
            for target in ((203, 204, 205, 206, 207, 208, 210, 225) if "--refine" in sys.argv else (125 if reference == 100 else 225,))]
        for reference, target in candidates:
            for mode in ("peak_fit", "soft_ceiling", "clip", "fixed_cap"):
                for format_name in ("jpeg_ultrahdr", "avif_gain_map", "jpegxl_hdr"):
                    record = {"reference": reference, "target": target, "mode": mode, "format": format_name,
                        "rounded_slider_candidate": True}
                    record.update(measure(reference, target, mode, format_name, backends[format_name], Path(scratch)))
                    records.append(record)
                    print(json.dumps(record), flush=True)
    Path(sys.argv[1]).write_text(json.dumps(records, indent=2))
