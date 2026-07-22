from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from tempfile import TemporaryDirectory
import subprocess

import numpy as np

from .adjustments import apply_adjustments
from .binaries import resolve_binary
from .config import EXPORTS_DIR, SAMPLES_DIR
from .models import AdjustmentState, CapabilityInfo, CapabilityStatus, ExportResponse, ExportSettings, PreviewKind
from .test_pattern import build_hdr_test_pattern


class ExportBackend(ABC):
    name: str

    def __init__(self, capability: CapabilityInfo) -> None:
        self.capability = capability

    @abstractmethod
    def export(self, session: object, settings: ExportSettings) -> ExportResponse:
        raise NotImplementedError


class StubExportBackend(ExportBackend):
    name = "stub"

    def export(self, session: object, settings: ExportSettings) -> ExportResponse:
        session_id = getattr(session, "session_id", "session")
        if self.capability.status != CapabilityStatus.AVAILABLE:
            return ExportResponse(
                accepted=False,
                backend=self.name,
                message=f"{settings.format} export is not available yet: {self.capability.detail}",
            )
        output_path = settings.output_path or str(Path.cwd() / f"{session_id}.{settings.format}")
        return ExportResponse(
            accepted=False,
            backend=self.name,
            message=f"{settings.format} export backend is detected but still stubbed in this milestone.",
            output_path=output_path,
        )


class SDRPNGExportBackend(ExportBackend):
    name = "sdr_png"

    def export(self, session: object, settings: ExportSettings) -> ExportResponse:
        if self.capability.status != CapabilityStatus.AVAILABLE:
            return ExportResponse(accepted=False, backend=self.name, message=self.capability.detail)

        output_path = _resolve_output_path(getattr(session, "session_id", "session"), settings, ".png")
        image = apply_adjustments(
            getattr(session, "image"),
            getattr(session, "adjustments"),
            PreviewKind.SDR,
            sdr_reference_image=getattr(session, "sdr_reference_image", None),
        )
        _write_sdr_png(Path(output_path), image)
        return ExportResponse(
            accepted=True,
            backend=self.name,
            message=f"SDR PNG exported to {output_path}",
            output_path=output_path,
        )


class AVIFGainMapExportBackend(ExportBackend):
    name = "avif_gain_map"

    def export(self, session: object, settings: ExportSettings) -> ExportResponse:
        if self.capability.status != CapabilityStatus.AVAILABLE:
            return ExportResponse(accepted=False, backend=self.name, message=self.capability.detail)

        avifenc = resolve_binary("avifenc")
        gainmaputil = resolve_binary("avifgainmaputil")
        if avifenc is None or gainmaputil is None:
            return ExportResponse(
                accepted=False,
                backend=self.name,
                message="AVIF gain map export requires avifenc and avifgainmaputil.",
            )

        output_path = Path(_resolve_output_path(getattr(session, "session_id", "session"), settings, ".avif"))
        output_path.parent.mkdir(parents=True, exist_ok=True)

        hdr_image = apply_adjustments(getattr(session, "image"), getattr(session, "adjustments"), PreviewKind.HDR)
        sdr_image = apply_adjustments(
            getattr(session, "image"),
            getattr(session, "adjustments"),
            PreviewKind.SDR,
            sdr_reference_image=getattr(session, "sdr_reference_image", None),
        )

        try:
            with TemporaryDirectory(prefix="hdr_finisher_export_") as temp_dir_name:
                temp_dir = Path(temp_dir_name)
                base_path = temp_dir / "base.png"
                hdr_y4m_path = temp_dir / "alternate_hdr.y4m"
                hdr_avif_path = temp_dir / "alternate_hdr.avif"

                _write_sdr_png(base_path, sdr_image)
                _write_hdr_y4m(hdr_y4m_path, hdr_image)
                _run_command(
                    [
                        str(avifenc),
                        "--cicp",
                        "9/16/9",
                        "-d",
                        "10",
                        "-y",
                        "444",
                        "-q",
                        str(int(settings.quality)),
                        str(hdr_y4m_path),
                        str(hdr_avif_path),
                    ]
                )
                _run_command(
                    [
                        str(gainmaputil),
                        "combine",
                        str(base_path),
                        str(hdr_avif_path),
                        str(output_path),
                        "--cicp-base",
                        "1/13/0",
                        "--cicp-alternate",
                        "9/16/9",
                        "--depth-gain-map",
                        "10",
                        "-q",
                        str(int(settings.quality)),
                    ]
                )
        except ExportProcessError as exc:
            return ExportResponse(accepted=False, backend=self.name, message=str(exc), output_path=str(output_path))

        validation = _validate_avif_output(output_path)
        message = f"AVIF gain map export finished at {output_path}"
        if validation:
            message = f"{message}. {validation}"
        return ExportResponse(accepted=True, backend=self.name, message=message, output_path=str(output_path))


class ExportProcessError(RuntimeError):
    """Raised when an external export command fails."""


def _resolve_output_path(session_id: str, settings: ExportSettings, suffix: str) -> str:
    if settings.output_path:
        target = Path(settings.output_path)
        if target.suffix.lower() != suffix:
            target = target.with_suffix(suffix)
    else:
        target = EXPORTS_DIR / f"{session_id}{suffix}"
    target.parent.mkdir(parents=True, exist_ok=True)
    return str(target.resolve())


def _write_sdr_png(path: Path, image: np.ndarray) -> None:
    try:
        from PIL import Image
    except ImportError as exc:
        raise ExportProcessError("Pillow is required to write SDR export intermediates.") from exc

    image_8bit = _linear_to_srgb8(image)
    Image.fromarray(image_8bit, mode="RGB").save(path, format="PNG")


def _linear_to_srgb8(image: np.ndarray) -> np.ndarray:
    clipped = np.clip(image.astype(np.float32, copy=False), 0.0, 1.0)
    srgb = np.where(clipped <= 0.0031308, clipped * 12.92, 1.055 * np.power(clipped, 1.0 / 2.4) - 0.055)
    return np.clip(np.round(srgb * 255.0), 0.0, 255.0).astype(np.uint8)


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


def _linear_to_pq_rgb10(image: np.ndarray) -> np.ndarray:
    linear = np.clip(image.astype(np.float32, copy=False), 0.0, None)
    nits = np.clip((linear / 0.18) * 100.0, 0.0, 10000.0)
    pq = _pq_oetf(nits / 10000.0)
    return np.clip(np.round(pq * 1023.0), 0.0, 1023.0).astype(np.uint16)


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


def _run_command(command: list[str]) -> None:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or f"Command failed with exit code {result.returncode}."
        raise ExportProcessError(detail)


def _validate_avif_output(path: Path) -> str | None:
    avifdec = resolve_binary("avifdec")
    if avifdec is None:
        return None
    result = subprocess.run([str(avifdec), "--info", str(path)], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        return "Output was written, but avifdec validation could not confirm it."
    if "Gain map" in result.stdout:
        return "Validated with avifdec."
    return "Output was written, but gain map metadata could not be confirmed."


def export_sample_hdr_reference(output_path: Path | None = None) -> ExportResponse:
    session = type(
        "SampleSession",
        (),
        {
            "session_id": "hdr_reference",
            "image": build_hdr_test_pattern(),
            "adjustments": AdjustmentState(),
        },
    )()
    target_path = output_path or (SAMPLES_DIR / "hdr_reference.avif")
    target_path.parent.mkdir(parents=True, exist_ok=True)
    settings = ExportSettings(format="avif_gain_map", quality=90, output_path=str(target_path))
    backend = AVIFGainMapExportBackend(
        CapabilityInfo(name="avif gain map export", status=CapabilityStatus.AVAILABLE, detail="Sample export")
    )
    return backend.export(session, settings)


def build_export_backends(capabilities: dict[str, CapabilityInfo]) -> dict[str, ExportBackend]:
    return {
        "avif_gain_map": AVIFGainMapExportBackend(capabilities["avif_gain_map_encoder"]),
        "jpeg_ultrahdr": StubExportBackend(capabilities["ultrahdr_encoder"]),
        "jpegxl_gain_map": StubExportBackend(capabilities["jpegxl_encoder"]),
        "sdr_png": SDRPNGExportBackend(capabilities["pillow"]),
    }
