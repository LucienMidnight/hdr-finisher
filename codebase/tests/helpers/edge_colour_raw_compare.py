"""Finished-pixel agreement including bright regions, using existing limits."""
import json
import os
from pathlib import Path
import sys
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.hdr_delivery import check_decoded_hdr_ceiling
from hdr_finisher.models import AdjustmentState, PreviewKind
from hdr_finisher.models import RawImportSettings
from hdr_finisher.loader import load_image
from hdr_finisher.library_pictures import reduce_picture
from hdr_finisher.delivery import FORCE_CPU_ENV

os.environ[FORCE_CPU_ENV] = "1"

data = json.loads(Path(sys.argv[1]).read_text())
folder = Path(data["folder"])
report = []
for row in data["rows"]:
    def proxy(record, half=False):
        h = record["proxy"]
        width, height, stride = (int(h[k]) for k in ("x-image-width", "x-image-height", "x-bytes-per-row"))
        size = 2 if half else 4
        return np.fromfile(folder / record["file"], "<f2" if half else "<f4").reshape(height, stride // size)[:, :width * 4].reshape(height, width, 4)[..., :3].astype(np.float32)
    cpu, gpu = proxy(row["cpu"]), proxy(row["gpu"])
    library = proxy(row["library"], half=True)
    # Grade proxies use Lanczos; Library's established source tiers use
    # bilinear. Compare each renderer against its actual CPU source route.
    reference_path = folder / (Path(row["photo"]).name + ".library-cpu.npy")
    if not reference_path.exists():
        settings = RawImportSettings.model_validate(row["cpu"]["session"]["edit_document"]["source"]["raw_import_settings"])
        image, *_ = load_image(Path(row["photo"]), raw_import_settings=settings)
        np.save(reference_path, reduce_picture(image, 2560))
        del image
    library_cpu = np.load(reference_path)
    grade = AdjustmentState.model_validate(row["cpu"]["session"]["adjustments"])
    grade.hdr.highlight_compression_target_nits = 1000
    grade.hdr.highlight_section_enabled = True
    checks = []
    for lane in ("sdr", "hdr"):
        for name, reference, image in (("Grade GPU", cpu, gpu), ("Library GPU", library_cpu, library)):
            first, second = [apply_adjustments(pixels, grade, PreviewKind(lane), color_context=RenderColorContext(203)) for pixels in (reference, image)]
            bright = np.max(reference, axis=-1) >= np.quantile(np.max(reference, axis=-1), .95)
            for region, mask in (("whole", None), ("brightest 5 percent", bright)):
                a, b = (first, second) if mask is None else (first[mask][None], second[mask][None])
                delta = compare_finished_pixels(a, b, lane)
                checks.append(dict(path=name, lane=lane, region=region, mean=delta.mean, p999=delta.p999, passed=delta.passed))
    ceiling = check_decoded_hdr_ceiling(folder / (Path(row["photo"]).name + ".jpg"), "jpeg_ultrahdr", 1000)
    report.append(dict(photo=Path(row["photo"]).name, checks=checks, ceiling=ceiling))
print(json.dumps(report))
(folder / "comparison.json").write_text(json.dumps(report, indent=2))
assert all(check["passed"] for photo in report for check in photo["checks"])
