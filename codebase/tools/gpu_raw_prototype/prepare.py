"""GPU RAW development prototype: dump a RAW's sensor data and the CPU reference.

Read-only on the photo. Writes, per photo, into output/gpu-raw-prototype/<name>/:
  mosaic.bin    the visible sensor mosaic, uint16 little-endian, before any repair
  meta.json     everything the GPU pipeline needs (levels, CFA, white balance,
                matrices, thresholds, calibration, orientation, sample stride)
  cpu.npz       Grade's CPU development (lens corrections off), reduced to the
                Library sizes, plus its full-source analysis and stage timings

Usage: python prepare.py <photo> [<photo> ...]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from time import perf_counter

import numpy as np

CODEBASE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(CODEBASE / "backend"))

from hdr_finisher import raw_import  # noqa: E402
from hdr_finisher.color import _ACESCG_TO_LINEAR_BT2020  # noqa: E402
from hdr_finisher.import_defaults import RAW_CALIBRATION_EV, fuji_dynamic_range  # noqa: E402
from hdr_finisher.library_pictures import reduce_picture  # noqa: E402
from hdr_finisher.loader import load_image  # noqa: E402
from hdr_finisher.models import RawImportSettings  # noqa: E402

OUTPUT = CODEBASE / "output" / "gpu-raw-prototype"
EDGES = (640, 2560)

# LibRaw constants used by AHD's CIELab conversion (dcraw xyz_rgb, d65_white).
XYZ_RGB = np.array([[0.412453, 0.357580, 0.180423],
                    [0.212671, 0.715160, 0.072169],
                    [0.019334, 0.119193, 0.950227]])
D65_WHITE = np.array([0.950456, 1.0, 1.088754])


def lens_off():
    settings = RawImportSettings()
    return settings.model_copy(update={"lens": settings.lens.model_copy(update={"mode": "off"})})


def flipped_shape(height, width, flip):
    return (width, height) if flip in (5, 6) else (height, width)


def prepare(path: Path) -> Path:
    import rawpy
    destination = OUTPUT / path.stem
    destination.mkdir(parents=True, exist_ok=True)
    with rawpy.imread(str(path)) as raw:
        metadata = raw_import._camera_linear_metadata_from_libraw(raw)
        if metadata.raw_pattern.shape != (2, 2):
            raise SystemExit(f"{path.name}: only Bayer sensors are in this prototype (X-Trans keeps the CPU route).")
        mosaic = np.array(raw.raw_image_visible, dtype="<u2", order="C", copy=True)  # LibRaw frees its buffer on close
        colors = np.asarray(raw.raw_colors_visible[:2, :2], dtype=np.int64)
        # LibRaw cam_xyz_coeff: rows normalized to sum 1, then inverted (3 colours).
        cam_rgb = np.asarray(raw.rgb_xyz_matrix, dtype=np.float64)[:3] @ XYZ_RGB
        cam_rgb /= cam_rgb.sum(axis=1, keepdims=True)
        rgb_cam = np.linalg.inv(cam_rgb)
        flip = int(raw.sizes.flip)
    height, width = mosaic.shape
    mosaic.tofile(destination / "mosaic.bin")

    raw_to_rgb = metadata.raw_channel_to_rgb
    cfa_raw = colors.reshape(-1).tolist()
    cfa_rgb = [int(raw_to_rgb[c]) for c in cfa_raw]
    xyz_cam = (XYZ_RGB @ rgb_cam) / D65_WHITE[:, None]
    threshold = RawImportSettings().highlight_reconstruction.clipping_threshold * raw_import.OPPOSED_COLOR_THRESHOLD_SAFETY
    dr = fuji_dynamic_range(path)
    gain = 2.0 ** (RAW_CALIBRATION_EV + {200: 1.0, 400: 2.0}.get(dr, 0.0))
    out_h, out_w = flipped_shape(height, width, flip)
    stride = max(1, int(np.ceil(np.sqrt((out_h * out_w) / 2_000_000))))
    sizes = {}
    for edge in EDGES:
        scale = edge / max(out_h, out_w)
        size_w, size_h = max(1, round(out_w * scale)), max(1, round(out_h * scale))
        # The GPU reduces in sensor orientation, so a 90 degree turn swaps the axes.
        sizes[str(edge)] = [size_h, size_w] if flip not in (5, 6) else [size_w, size_h]
    meta = {
        "name": path.name, "width": width, "height": height, "flip": flip,
        "cfa_raw": cfa_raw, "cfa_rgb": cfa_rgb,
        "raw_black": metadata.raw_black_level.tolist(), "raw_white": metadata.raw_white_level.tolist(),
        "rgb_black": metadata.black_level.tolist(), "rgb_white": metadata.white_level.tolist(),
        "wb": metadata.as_shot_wb.tolist(),
        "camera_to_acescg": metadata.camera_to_acescg.tolist(),
        "xyz_cam": xyz_cam.tolist(),
        "acescg_to_bt2020": np.asarray(_ACESCG_TO_LINEAR_BT2020).T.tolist(),  # stored for row vectors
        "threshold": threshold, "calibration_gain": gain, "fuji_dr": dr,
        "sample_stride": stride, "reduced_sizes_sensor": sizes,
    }
    (destination / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")

    started = perf_counter()
    image, _descriptor, cpu_meta, analysis, _reference = load_image(path, raw_import_settings=lens_off())
    total = perf_counter() - started
    arrays = {f"reduced_{edge}": reduce_picture(image, edge) for edge in EDGES}
    np.savez(destination / "cpu.npz", **arrays,
             analysis=np.asarray(json.dumps(analysis.model_dump(mode="json"))),
             timings=np.asarray(json.dumps({"total_s": total, **cpu_meta.get("import_timings_ms", {})})),
             shape=np.asarray(image.shape))
    print(json.dumps({"photo": path.name, "size": [height, width], "flip": flip,
                      "cpu_total_s": round(total, 2), "highlights": cpu_meta.get("raw_highlight_reconstruction", {}).get("clipped_photosites_per_rgb")}))
    return destination


if __name__ == "__main__":
    for argument in sys.argv[1:]:
        prepare(Path(argument))
