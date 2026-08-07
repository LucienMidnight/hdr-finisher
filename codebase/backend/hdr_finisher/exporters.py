from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
import os
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory
import subprocess

import numpy as np

from .adjustments import apply_adjustments
from .binaries import resolve_binary
from .color import acescg_to_linear_bt2020
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


class ExportOverwriteRequired(FileExistsError):
    def __init__(self, output_path: Path) -> None:
        self.output_path = output_path
        super().__init__(f"A file already exists at {output_path}")


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
        _require_overwrite_permission(Path(output_path), settings)
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
        _require_overwrite_permission(output_path, settings)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        hdr_image = apply_adjustments(getattr(session, "image"), getattr(session, "adjustments"), PreviewKind.HDR)
        sdr_image = apply_adjustments(
            getattr(session, "image"),
            getattr(session, "adjustments"),
            PreviewKind.SDR,
            sdr_reference_image=getattr(session, "sdr_reference_image", None),
        )

        staged_output: Path | None = None
        try:
            with NamedTemporaryFile(
                prefix=f".{output_path.stem}.", suffix=".gainmap.tmp.avif", dir=output_path.parent, delete=False
            ) as staged_file:
                staged_output = Path(staged_file.name)
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
                        str(staged_output),
                        "--cicp-base",
                        "1/13/0",
                        "--cicp-alternate",
                        "9/16/9",
                        "--depth-gain-map",
                        "10",
                        "--qgain-map",
                        str(int(settings.quality)),
                        "--max-headroom",
                        "0",
                        "-q",
                        str(int(settings.quality)),
                    ]
                )
            validation = _validate_avif_output(staged_output)
            os.replace(staged_output, output_path)
            staged_output = None
        except (ExportProcessError, OSError, ValueError) as exc:
            _remove_incomplete_output(staged_output)
            return ExportResponse(accepted=False, backend=self.name, message=str(exc), output_path=str(output_path))

        message = f"AVIF gain map export finished at {output_path}"
        if validation:
            message = f"{message}. {validation}"
        return ExportResponse(accepted=True, backend=self.name, message=message, output_path=str(output_path))


class JPEGUltraHDRExportBackend(ExportBackend):
    """Encode an SDR-first JPEG with an embedded HDR gain map using libultrahdr."""

    name = "jpeg_ultrahdr"

    def export(self, session: object, settings: ExportSettings) -> ExportResponse:
        if self.capability.status != CapabilityStatus.AVAILABLE:
            return ExportResponse(accepted=False, backend=self.name, message=self.capability.detail)

        ultrahdr_app = resolve_binary("ultrahdr_app")
        if ultrahdr_app is None:
            return ExportResponse(
                accepted=False,
                backend=self.name,
                message="JPEG Ultra HDR export requires a working ultrahdr_app binary in bin/ or on PATH.",
            )

        output_path = Path(_resolve_output_path(getattr(session, "session_id", "session"), settings, ".jpg"))
        _require_overwrite_permission(output_path, settings)
        hdr_image = apply_adjustments(getattr(session, "image"), getattr(session, "adjustments"), PreviewKind.HDR)
        sdr_image = apply_adjustments(
            getattr(session, "image"),
            getattr(session, "adjustments"),
            PreviewKind.SDR,
            sdr_reference_image=getattr(session, "sdr_reference_image", None),
        )

        if hdr_image.shape != sdr_image.shape or hdr_image.ndim != 3 or hdr_image.shape[2] < 3:
            return ExportResponse(
                accepted=False,
                backend=self.name,
                message="The independently authored HDR and SDR renditions must have matching RGB dimensions.",
                output_path=str(output_path),
            )

        staged_output: Path | None = None
        try:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with NamedTemporaryFile(
                prefix=f".{output_path.stem}.", suffix=".ultrahdr.tmp.jpg", dir=output_path.parent, delete=False
            ) as staged_file:
                staged_output = Path(staged_file.name)

            with TemporaryDirectory(prefix="hdr_finisher_ultrahdr_") as temp_dir_name:
                temp_dir = Path(temp_dir_name)
                hdr_raw_path = temp_dir / "hdr_bt2020_linear_rgba_f16.raw"
                sdr_raw_path = temp_dir / "sdr_srgb_rgba8888.raw"
                _write_hdr_linear_rgba_f16(hdr_raw_path, hdr_image)
                _write_sdr_rgba8888(sdr_raw_path, sdr_image)
                command = _build_ultrahdr_encode_command(
                    ultrahdr_app,
                    hdr_raw_path,
                    sdr_raw_path,
                    staged_output,
                    width=int(hdr_image.shape[1]),
                    height=int(hdr_image.shape[0]),
                    quality=int(settings.quality),
                    gain_map_quality=int(settings.jpeg_gain_map_quality),
                    gain_map_scale=settings.jpeg_gain_map_scale,
                    target_peak_nits=_target_hdr_peak_nits(hdr_image),
                )
                _run_command(command)

            validation = _validate_ultrahdr_output(staged_output, ultrahdr_app)
            os.replace(staged_output, output_path)
            staged_output = None
        except (ExportProcessError, OSError, ValueError) as exc:
            _remove_incomplete_output(staged_output)
            return ExportResponse(
                accepted=False,
                backend=self.name,
                message=f"JPEG Ultra HDR export failed: {exc}",
                output_path=str(output_path),
            )

        return ExportResponse(
            accepted=True,
            backend=self.name,
            message=f"JPEG Ultra HDR exported to {output_path}. {validation}",
            output_path=str(output_path),
        )


class ExportProcessError(RuntimeError):
    """Raised when an external export command fails."""


def _resolve_output_path(session_id: str, settings: ExportSettings, suffix: str) -> str:
    if settings.output_path:
        target = Path(settings.output_path)
        if target.suffix.lower() != suffix:
            target = target.with_suffix(suffix)
        if not target.is_absolute():
            target = EXPORTS_DIR / target
    else:
        target = EXPORTS_DIR / f"{session_id}{suffix}"
    target.parent.mkdir(parents=True, exist_ok=True)
    return str(target.resolve())


def _require_overwrite_permission(output_path: Path, settings: ExportSettings) -> None:
    if output_path.exists() and not settings.overwrite:
        raise ExportOverwriteRequired(output_path)


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


def _write_sdr_rgba8888(path: Path, image: np.ndarray) -> None:
    rgb = _linear_to_srgb8(image[..., :3])
    alpha = np.full((*rgb.shape[:2], 1), 255, dtype=np.uint8)
    rgba = np.concatenate([rgb, alpha], axis=-1)
    path.write_bytes(rgba.tobytes(order="C"))


def _write_hdr_linear_rgba_f16(path: Path, image: np.ndarray) -> None:
    linear_bt2020 = _acescg_to_bt2020_linear(image[..., :3])
    # HDR Finisher defines 0.18 as 100 nits. libultrahdr's linear input defines 1.0 as
    # its 203-nit SDR reference white, so preserve absolute luminance with this scale.
    linear_bt2020 *= np.float32((100.0 / 0.18) / 203.0)
    linear_bt2020 = np.nan_to_num(linear_bt2020, nan=0.0, posinf=10000.0 / 203.0, neginf=0.0)
    linear_bt2020 = np.clip(linear_bt2020, 0.0, 10000.0 / 203.0)
    alpha = np.ones((*linear_bt2020.shape[:2], 1), dtype=np.float32)
    rgba = np.concatenate([linear_bt2020, alpha], axis=-1).astype("<f2")
    path.write_bytes(rgba.tobytes(order="C"))


def _acescg_to_bt2020_linear(image: np.ndarray) -> np.ndarray:
    try:
        return acescg_to_linear_bt2020(image)
    except ImportError as exc:
        raise ExportProcessError("colour-science is required for JPEG Ultra HDR color conversion.") from exc


def _target_hdr_peak_nits(image: np.ndarray) -> float:
    bt2020 = np.clip(_acescg_to_bt2020_linear(image[..., :3]), 0.0, None)
    luma = 0.2627 * bt2020[..., 0] + 0.6780 * bt2020[..., 1] + 0.0593 * bt2020[..., 2]
    peak_nits = float(np.max(luma, initial=0.0)) * (100.0 / 0.18)
    return float(np.clip(peak_nits, 203.0, 10000.0))


def _format_cli_float(value: float) -> str:
    return f"{value:.6f}".rstrip("0").rstrip(".")


def _build_ultrahdr_encode_command(
    ultrahdr_app: Path,
    hdr_raw_path: Path,
    sdr_raw_path: Path,
    output_path: Path,
    *,
    width: int,
    height: int,
    quality: int,
    gain_map_quality: int,
    gain_map_scale: str,
    target_peak_nits: float,
) -> list[str]:
    if width <= 0 or height <= 0:
        raise ValueError("Ultra HDR dimensions must be positive.")
    if not 1 <= quality <= 100:
        raise ValueError("Ultra HDR quality must be between 1 and 100.")
    if not 1 <= gain_map_quality <= 100:
        raise ValueError("Ultra HDR gain-map quality must be between 1 and 100.")
    if gain_map_scale not in {"full", "half"}:
        raise ValueError("Ultra HDR gain-map scale must be 'full' or 'half'.")
    return [
        str(ultrahdr_app),
        "-m",
        "0",
        "-p",
        str(hdr_raw_path),
        "-y",
        str(sdr_raw_path),
        "-w",
        str(width),
        "-h",
        str(height),
        "-a",
        "4",  # 64-bit RGBA half-float HDR intent
        "-b",
        "3",  # 32-bit RGBA8888 SDR intent
        "-C",
        "2",  # BT.2100 / BT.2020 HDR gamut
        "-c",
        "0",  # BT.709 / sRGB SDR gamut
        "-t",
        "0",  # linear HDR transfer
        "-q",
        str(quality),
        "-Q",
        str(gain_map_quality),
        "-s",
        "1" if gain_map_scale == "full" else "2",
        "-M",
        "1",
        "-G",
        "1.0",
        "-D",
        "1",
        "-L",
        _format_cli_float(float(np.clip(target_peak_nits, 203.0, 10000.0))),
        "-z",
        str(output_path),
    ]


@dataclass(frozen=True)
class UltraHDRMarkers:
    jpeg_images: int
    ultra_hdr_v1: bool
    iso_21496_1: bool


def _inspect_ultrahdr_markers(path: Path) -> UltraHDRMarkers:
    payload = path.read_bytes()
    return UltraHDRMarkers(
        jpeg_images=payload.count(b"\xff\xd8"),
        ultra_hdr_v1=(b"http://ns.adobe.com/hdr-gain-map/1.0/" in payload and b"hdrgm:Version" in payload),
        iso_21496_1=b"urn:iso:std:iso:ts:21496:-1" in payload,
    )


def _validate_ultrahdr_output(path: Path, ultrahdr_app: Path) -> str:
    if not path.exists() or path.stat().st_size == 0:
        raise ExportProcessError("The encoder did not create an output file.")
    if path.read_bytes()[:2] != b"\xff\xd8":
        raise ExportProcessError("The encoder output is not a valid JPEG stream.")

    try:
        from PIL import Image

        with Image.open(path) as legacy_image:
            legacy_image.load()
            if legacy_image.format != "JPEG":
                raise ExportProcessError("The SDR fallback is not decodable as a legacy JPEG.")
    except ExportProcessError:
        raise
    except Exception as exc:
        raise ExportProcessError(f"The SDR fallback failed legacy JPEG decoding: {exc}") from exc

    markers = _inspect_ultrahdr_markers(path)
    if markers.jpeg_images < 2:
        raise ExportProcessError("No embedded JPEG gain-map image was found.")
    if not markers.ultra_hdr_v1 or not markers.iso_21496_1:
        missing = []
        if not markers.ultra_hdr_v1:
            missing.append("Ultra HDR v1 XMP")
        if not markers.iso_21496_1:
            missing.append("ISO 21496-1")
        raise ExportProcessError(
            "Missing "
            + " and ".join(missing)
            + " metadata. Rebuild libultrahdr with UHDR_WRITE_XMP=ON and UHDR_WRITE_ISO=ON."
        )

    probe = _run_command([str(ultrahdr_app), "-m", "1", "-j", str(path), "-P"])
    probe_text = f"{probe.stdout}\n{probe.stderr}".lower()
    if "maxcontentboost" not in probe_text or "hdrcapacitymax" not in probe_text:
        raise ExportProcessError("libultrahdr decoded the file but did not report gain-map metadata.")
    return "Validated as legacy JPEG plus embedded gain map with Ultra HDR v1 and ISO 21496-1 metadata."


def _remove_incomplete_output(path: Path | None) -> None:
    if path is None:
        return
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


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
    linear_bt2020 = _acescg_to_bt2020_linear(image)
    pq_rgb = _linear_to_pq_rgb10(linear_bt2020).astype(np.float32) / 1023.0

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


def _run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=False)
    except OSError as exc:
        raise ExportProcessError(f"Could not start {Path(command[0]).name}: {exc}") from exc
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or f"Command failed with exit code {result.returncode}."
        raise ExportProcessError(detail)
    return result


def _validate_avif_output(path: Path) -> str | None:
    avifdec = resolve_binary("avifdec")
    if avifdec is None:
        return None
    result = subprocess.run([str(avifdec), "--info", str(path)], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "avifdec could not decode the result."
        raise ExportProcessError(f"AVIF validation failed: {detail}")
    if "Gain map" in result.stdout:
        return "Validated with avifdec."
    raise ExportProcessError("AVIF validation did not find an embedded gain map.")


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
        "jpeg_ultrahdr": JPEGUltraHDRExportBackend(capabilities["ultrahdr_encoder"]),
        "jpegxl_gain_map": StubExportBackend(capabilities["jpegxl_encoder"]),
        "sdr_png": SDRPNGExportBackend(capabilities["pillow"]),
    }
