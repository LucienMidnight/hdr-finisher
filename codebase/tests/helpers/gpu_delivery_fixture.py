"""Small fixture; finished renderer gate with report-only encoding diagnostics."""
import json
from pathlib import Path
import sys

import numpy as np

from delivery_comparison import compare_delivery
from hdr_finisher.hdr_delivery import check_decoded_hdr_ceiling

if sys.argv[1] == "make":
    import tifffile
    denoise = len(sys.argv) > 3 and sys.argv[3] == "denoise"
    height, width = (128, 192) if denoise else (64, 96)
    rows, columns = np.mgrid[:height, :width].astype(np.float32)
    values = .015 + .55 * (columns / (width - 1)) ** 2 + .04 * np.sin(rows / 5) ** 2
    image = np.stack([values, values * .87, values * .65], axis=-1)
    if denoise:
        image += np.random.default_rng(904).normal(0, .005, image.shape).astype(np.float32)
        image[:, :48] = 1.25
    tifffile.imwrite(sys.argv[2], image, photometric="rgb")
elif sys.argv[1] == "make-authored":
    from hdr_finisher.exporters import JPEGUltraHDRExportBackend
    from hdr_finisher.models import CapabilityInfo, CapabilityStatus, ExportSettings
    from hdr_finisher.sessions import SessionStore

    session = SessionStore().prepare_session(Path(sys.argv[2]), owns_source_path=False)
    session.adjustments.hdr.exposure = .75
    session.adjustments.sdr.exposure = -.45
    backend = JPEGUltraHDRExportBackend(CapabilityInfo(name="JPEG Ultra HDR", status=CapabilityStatus.AVAILABLE, detail="Test fixture"))
    result = backend.export(session, ExportSettings(format="jpeg_ultrahdr", output_path=sys.argv[3], dithering="off"))
    assert result.accepted, result
elif sys.argv[1] == "compare-authored":
    from delivery_comparison import finished_capture, metric, percentile99

    root = Path(sys.argv[2])
    exports = {}
    for name in ("off", "on"):
        folder, _ = finished_capture(root / f"{name}.jpg")
        exports[name] = np.load(folder / "sdr.npy")
    assert not np.array_equal(exports["on"], exports["off"]), "CPU export ignored Denoise on authored SDR"
    capture = json.loads((root / "grade.json").read_text())
    rgb = np.asarray(capture["values"], dtype=np.float32).reshape(capture["height"], capture["width"], 4)[..., :3]
    if capture["format"].startswith("bgra"):
        rgb = rgb[..., ::-1]
    linear = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
    result = metric(linear, exports["on"], "sdr")
    result["p99"] = percentile99(linear, exports["on"], "sdr", 203)
    print(json.dumps(result))
    assert result["passed"] and result["p99"] < 3, result
else:
    root = Path(sys.argv[2])
    result = compare_delivery(root / "gpu.jpg", root / "cpu.jpg")
    for lane, agreement in result["renderer_agreement"].items():
        result[lane] = dict(agreement, denoise_passed=agreement["passed"] and agreement["p99"] < 3)
    result["peak_nits"] = max(check_decoded_hdr_ceiling(root / f"{renderer}.jpg", "jpeg_ultrahdr", 1000)
                              for renderer in ("gpu", "cpu"))
    print(json.dumps(result))
