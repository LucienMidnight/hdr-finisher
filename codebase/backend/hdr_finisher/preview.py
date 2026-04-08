from __future__ import annotations

from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import subprocess

import numpy as np

from .adjustments import apply_adjustments
from .binaries import resolve_binary
from .config import MAX_PREVIEW_LONG_EDGE, PREVIEW_IMAGE_FORMAT
from .models import AdjustmentState, PreviewKind


def render_preview_bytes(
    image: np.ndarray,
    adjustments: AdjustmentState,
    kind: PreviewKind,
    long_edge: int = MAX_PREVIEW_LONG_EDGE,
    sdr_reference_image: np.ndarray | None = None,
) -> tuple[bytes, str]:
    processed = apply_adjustments(image, adjustments, kind, sdr_reference_image=sdr_reference_image)
    downsampled = downsample_image(processed, long_edge)
    if kind == PreviewKind.HDR:
        return _encode_hdr_avif(downsampled), "image/avif"
    return _encode_png_sdr(downsampled), "image/png"


def downsample_image(image: np.ndarray, max_long_edge: int) -> np.ndarray:
    height, width = image.shape[:2]
    long_edge = max(height, width)
    if long_edge <= max_long_edge:
        return image
    scale = max_long_edge / long_edge
    target_h = max(1, int(round(height * scale)))
    target_w = max(1, int(round(width * scale)))
    ys = np.linspace(0, height - 1, target_h).astype(np.int32)
    xs = np.linspace(0, width - 1, target_w).astype(np.int32)
    return image[np.ix_(ys, xs)]


def _encode_png(image: np.ndarray) -> bytes:
    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("Pillow is required for preview rendering.") from exc

    image_8bit = (np.clip(image, 0.0, 1.0) * 255.0).astype(np.uint8)
    buffer = BytesIO()
    Image.fromarray(image_8bit).save(buffer, format=PREVIEW_IMAGE_FORMAT)
    return buffer.getvalue()


def _encode_png_sdr(image: np.ndarray) -> bytes:
    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("Pillow is required for preview rendering.") from exc

    encoded = np.where(
        image <= 0.0031308,
        image * 12.92,
        1.055 * np.power(np.clip(image, 0.0, 1.0), 1.0 / 2.4) - 0.055,
    )
    image_8bit = (np.clip(encoded, 0.0, 1.0) * 255.0).astype(np.uint8)
    buffer = BytesIO()
    Image.fromarray(image_8bit).save(buffer, format=PREVIEW_IMAGE_FORMAT)
    return buffer.getvalue()


def _encode_hdr_avif(image: np.ndarray) -> bytes:
    avifenc = resolve_binary("avifenc")
    if avifenc is None:
        raise RuntimeError("avifenc is required for HDR AVIF preview rendering.")

    try:
        with TemporaryDirectory(prefix="hdr_finisher_preview_") as temp_dir_name:
            temp_dir = Path(temp_dir_name)
            y4m_path = temp_dir / "preview_hdr.y4m"
            avif_path = temp_dir / "preview_hdr.avif"
            _write_hdr_y4m(y4m_path, image)
            result = subprocess.run(
                [
                    str(avifenc),
                    "--cicp",
                    "9/16/9",
                    "-d",
                    "10",
                    "-y",
                    "444",
                    "-s",
                    "6",
                    "-q",
                    "82",
                    str(y4m_path),
                    str(avif_path),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode != 0:
                detail = result.stderr.strip() or result.stdout.strip() or "avifenc failed to encode preview."
                raise RuntimeError(detail)
            return avif_path.read_bytes()
    except OSError as exc:
        raise RuntimeError("Failed to encode HDR AVIF preview.") from exc


def _write_hdr_y4m(path: Path, image: np.ndarray) -> None:
    yuv10 = _linear_to_bt2020_pq_yuv10(image)
    height, width = yuv10.shape[:2]
    header = f"YUV4MPEG2 W{width} H{height} F1:1 Ip A1:1 C444p10 XYSCSS=444P10\n".encode("ascii")
    frame_header = b"FRAME\n"

    with path.open("wb") as handle:
        handle.write(header)
        handle.write(frame_header)
        for plane_index in range(3):
            handle.write(yuv10[..., plane_index].astype("<u2", copy=False).tobytes())


def _linear_to_bt2020_pq_yuv10(image: np.ndarray) -> np.ndarray:
    pq_rgb = _linear_to_pq_rgb10(image).astype(np.float32) / 1023.0

    r = pq_rgb[..., 0]
    g = pq_rgb[..., 1]
    b = pq_rgb[..., 2]

    kr = np.float32(0.2627)
    kb = np.float32(0.0593)
    kg = np.float32(1.0 - kr - kb)

    y = kr * r + kg * g + kb * b
    cb = (b - y) / (2.0 * (1.0 - kb))
    cr = (r - y) / (2.0 * (1.0 - kr))

    y_code = np.clip(np.round(64.0 + (y * 876.0)), 64.0, 940.0)
    cb_code = np.clip(np.round(512.0 + (cb * 896.0)), 64.0, 960.0)
    cr_code = np.clip(np.round(512.0 + (cr * 896.0)), 64.0, 960.0)
    return np.stack([y_code, cb_code, cr_code], axis=-1).astype(np.uint16)


def _linear_to_pq_rgb10(image: np.ndarray) -> np.ndarray:
    linear = np.clip(image.astype(np.float32, copy=False), 0.0, None)
    nits = np.clip((linear / 0.18) * 100.0, 0.0, 10000.0)
    pq = _pq_oetf(nits / 10000.0)
    return np.clip(np.round(pq * 1023.0), 0.0, 1023.0).astype(np.uint16)


def _pq_oetf(normalized_luminance: np.ndarray) -> np.ndarray:
    m1 = 2610.0 / 16384.0
    m2 = 2523.0 / 32.0
    c1 = 3424.0 / 4096.0
    c2 = 2413.0 / 128.0
    c3 = 2392.0 / 128.0
    lm1 = np.power(np.clip(normalized_luminance, 0.0, None), m1)
    numerator = c1 + c2 * lm1
    denominator = 1.0 + c3 * lm1
    return np.power(numerator / denominator, m2)
