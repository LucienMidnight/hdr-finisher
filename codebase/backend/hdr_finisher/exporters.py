from __future__ import annotations

from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from io import BytesIO
import os
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory
import subprocess
from time import perf_counter
import zlib

import numpy as np

from .adjustments import apply_adjustments, apply_final_grain
from .binaries import resolve_binary
from .subprocess_utils import hidden_window_options
from .color import acescg_to_linear_bt2020
from .color_context import RenderColorContext, scene_linear_to_nits
from .config import EXPORTS_DIR, SAMPLES_DIR
from .finishing import apply_output_finishing
from .gainmap_decoders import parse_jpeg_gain_map_probe
from .models import AdjustmentState, CapabilityInfo, CapabilityStatus, ExportResponse, ExportSettings, PreviewKind
from .jpegxl import (
    JPEGXLError,
    encode_hdr_jpegxl,
    encode_sdr_jpegxl,
    validate_jpegxl,
    validate_sdr_jpegxl,
)
from .test_pattern import build_hdr_test_pattern


SDR_WHITE_NITS = 203.0
# JPEG Ultra HDR stores its gain map in eight bits. Leave enough latitude for
# independently authored SDR/HDR color differences while preventing near-zero
# channel ratios from consuming libultrahdr's entire -14.3..15.6 stop range.
# A 16x difference in either direction is already generous for a publishing
# rendition; the positive bound expands further when the authored HDR peak
# requires it.
ULTRAHDR_CHROMATIC_LATITUDE_STOPS = 4.0
# A small guided filter removes pixel-scale HDR/SDR ratio noise before Safari
# and other viewers multiply it back into the SDR primary. The encoded SDR
# remains untouched, and the SDR image itself guides the filter so real edges
# are retained. These defaults were visually accepted on the DSC01286 Sony RAW
# fixture in both Safari and Chrome.
ULTRAHDR_GAIN_MAP_DENOISE_RADIUS = 2
ULTRAHDR_GAIN_MAP_DENOISE_EPSILON = 0.0025
ULTRAHDR_GAIN_MAP_DENOISE_AMOUNT = 0.75
ULTRAHDR_GAIN_MAP_DENOISE_STRIPE_ROWS = 256


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


def _finishing_adjustments_for_export(session: object) -> AdjustmentState:
    """Strip viewer-only diagnostic maps without changing the saved grade."""
    adjustments = getattr(session, "adjustments").model_copy(deep=True)
    adjustments.hdr.film_look.halation_view_map = False
    adjustments.sdr.film_look.halation_view_map = False
    return adjustments


def _render_export_branch(
    session: object, settings: ExportSettings, kind: PreviewKind, adjustments: AdjustmentState
) -> np.ndarray:
    color_context = getattr(session, "color_context", RenderColorContext(getattr(session, "hdr_reference_white_nits", 203)))
    image = apply_adjustments(
        getattr(session, "image"),
        adjustments,
        kind,
        sdr_reference_image=getattr(session, "sdr_reference_image", None),
        include_grain=False,
        local_adjustments=getattr(session, "local_adjustments", None),
        color_context=color_context,
    )
    image = apply_output_finishing(image, settings.output_finishing, kind)
    return apply_final_grain(image, adjustments, kind)


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
        finishing_adjustments = _finishing_adjustments_for_export(session)
        image = _render_export_branch(session, settings, PreviewKind.SDR, finishing_adjustments)
        try:
            _write_sdr_atomic(
                Path(output_path),
                ".png",
                lambda staged: _write_sdr_png(
                    staged,
                    image,
                    bit_depth=settings.sdr_png_bit_depth,
                    dithering=settings.dithering,
                    exif_payload=_source_exif_payload(session, settings.metadata_policy),
                ),
            )
        except (ExportProcessError, OSError, ValueError) as exc:
            return ExportResponse(
                accepted=False,
                backend=self.name,
                message=f"SDR PNG export failed: {exc}",
                output_path=output_path,
            )
        return ExportResponse(
            accepted=True,
            backend=self.name,
            message=f"SDR PNG exported to {output_path}",
            output_path=output_path,
        )


class SDRJPEGExportBackend(ExportBackend):
    name = "sdr_jpeg"

    def export(self, session: object, settings: ExportSettings) -> ExportResponse:
        if self.capability.status != CapabilityStatus.AVAILABLE:
            return ExportResponse(accepted=False, backend=self.name, message=self.capability.detail)

        output_path = _resolve_output_path(getattr(session, "session_id", "session"), settings, ".jpg")
        _require_overwrite_permission(Path(output_path), settings)
        finishing_adjustments = _finishing_adjustments_for_export(session)
        image = _render_export_branch(session, settings, PreviewKind.SDR, finishing_adjustments)
        try:
            _write_sdr_atomic(
                Path(output_path),
                ".jpg",
                lambda staged: _write_sdr_jpeg(
                    staged,
                    image,
                    quality=settings.quality,
                    chroma_subsampling=settings.jpeg_chroma_subsampling,
                    dithering=settings.dithering,
                    exif_payload=_source_exif_payload(session, settings.metadata_policy),
                ),
            )
        except (ExportProcessError, OSError, ValueError) as exc:
            return ExportResponse(
                accepted=False,
                backend=self.name,
                message=f"SDR JPEG export failed: {exc}",
                output_path=output_path,
            )
        return ExportResponse(
            accepted=True,
            backend=self.name,
            message=f"SDR JPEG exported to {output_path}",
            output_path=output_path,
        )


class SDRJPEGXLExportBackend(ExportBackend):
    """Encode the authored SDR branch as conventional 8-bit sRGB JPEG XL."""

    name = "sdr_jpegxl"

    def export(self, session: object, settings: ExportSettings) -> ExportResponse:
        if self.capability.status != CapabilityStatus.AVAILABLE:
            return ExportResponse(accepted=False, backend=self.name, message=self.capability.detail)
        output_path = Path(_resolve_output_path(getattr(session, "session_id", "session"), settings, ".jxl"))
        _require_overwrite_permission(output_path, settings)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        finishing_adjustments = _finishing_adjustments_for_export(session)
        sdr_image = _render_export_branch(session, settings, PreviewKind.SDR, finishing_adjustments)
        staged_output: Path | None = None
        try:
            payload = encode_sdr_jpegxl(
                sdr_image,
                int(settings.quality),
                dithering=settings.dithering,
                exif_payload=_source_exif_payload(session, settings.metadata_policy),
            )
            validation = validate_sdr_jpegxl(payload, sdr_image.shape[:2])
            with NamedTemporaryFile(
                prefix=f".{output_path.stem}.", suffix=".sdr.tmp.jxl", dir=output_path.parent, delete=False
            ) as staged_file:
                staged_output = Path(staged_file.name)
                staged_file.write(payload)
                staged_file.flush()
                os.fsync(staged_file.fileno())
            os.replace(staged_output, output_path)
            staged_output = None
        except (JPEGXLError, OSError, ValueError) as exc:
            _remove_incomplete_output(staged_output)
            return ExportResponse(
                accepted=False,
                backend=self.name,
                message=f"JPEG XL SDR export failed: {exc}",
                output_path=str(output_path),
            )
        return ExportResponse(
            accepted=True,
            backend=self.name,
            message=f"JPEG XL SDR exported to {output_path}. {validation}",
            output_path=str(output_path),
        )


class AVIFGainMapExportBackend(ExportBackend):
    name = "avif_gain_map"

    def export(self, session: object, settings: ExportSettings) -> ExportResponse:
        if self.capability.status != CapabilityStatus.AVAILABLE:
            return ExportResponse(accepted=False, backend=self.name, message=self.capability.detail)

        gainmaputil = resolve_binary("avifgainmaputil")
        if gainmaputil is None:
            return ExportResponse(
                accepted=False,
                backend=self.name,
                message="AVIF gain map export requires avifgainmaputil.",
            )

        output_path = Path(_resolve_output_path(getattr(session, "session_id", "session"), settings, ".avif"))
        _require_overwrite_permission(output_path, settings)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        timings_ms: dict[str, float] = {}
        finishing_adjustments = _finishing_adjustments_for_export(session)
        phase_started = perf_counter()
        hdr_image = _render_export_branch(session, settings, PreviewKind.HDR, finishing_adjustments)
        sdr_image = _render_export_branch(session, settings, PreviewKind.SDR, finishing_adjustments)
        timings_ms["render_renditions"] = round((perf_counter() - phase_started) * 1000.0, 3)

        staged_output: Path | None = None
        try:
            with NamedTemporaryFile(
                prefix=f".{output_path.stem}.", suffix=".gainmap.tmp.avif", dir=output_path.parent, delete=False
            ) as staged_file:
                staged_output = Path(staged_file.name)
            with TemporaryDirectory(prefix="hdr_finisher_export_") as temp_dir_name:
                temp_dir = Path(temp_dir_name)
                base_y4m_path = temp_dir / "base_sdr.y4m"
                hdr_y4m_path = temp_dir / "alternate_hdr.y4m"

                phase_started = perf_counter()
                _write_sdr_y4m(
                    base_y4m_path,
                    sdr_image,
                    bit_depth=settings.avif_bit_depth,
                    chroma_subsampling=settings.avif_chroma_subsampling,
                    dithering=settings.dithering,
                )
                _write_hdr_y4m(
                    hdr_y4m_path,
                    hdr_image,
                    bit_depth=settings.avif_bit_depth,
                    # Gain-map computation needs an unreduced HDR reference.
                    # The selected chroma still controls the delivered base and
                    # final primary item below.
                    chroma_subsampling="444",
                    reference_white_nits=getattr(session, "hdr_reference_white_nits", 203),
                )
                timings_ms["prepare_y4m"] = round((perf_counter() - phase_started) * 1000.0, 3)
                phase_started = perf_counter()
                _run_command(
                    [
                        str(gainmaputil),
                        "combine",
                        str(base_y4m_path),
                        # avifgainmaputil accepts Y4M directly. Passing the
                        # authored HDR rendition avoids a redundant lossy AVIF
                        # encode followed by an immediate decode inside the
                        # combiner, while preserving its full 4:4:4 reference.
                        str(hdr_y4m_path),
                        str(staged_output),
                        "--cicp-base",
                        "1/13/1",
                        "--cicp-alternate",
                        "9/16/9",
                        "--depth-gain-map",
                        "10",
                        "--yuv-gain-map",
                        settings.avif_gain_map_chroma_subsampling,
                        "--qgain-map",
                        str(int(settings.avif_gain_map_quality or settings.quality)),
                        "--downscaling",
                        "1" if settings.avif_gain_map_scale == "full" else "2",
                        "--max-headroom",
                        "0",
                        "-q",
                        str(int(settings.quality)),
                        "-d",
                        str(settings.avif_bit_depth),
                        "-y",
                        settings.avif_chroma_subsampling,
                    ]
                )
                timings_ms["encode"] = round((perf_counter() - phase_started) * 1000.0, 3)
            phase_started = perf_counter()
            validation = _validate_avif_output(
                staged_output,
                expected_bit_depth=settings.avif_bit_depth,
                expected_chroma=settings.avif_chroma_subsampling,
                expected_gain_map_chroma=settings.avif_gain_map_chroma_subsampling,
            )
            timings_ms["validate"] = round((perf_counter() - phase_started) * 1000.0, 3)
            os.replace(staged_output, output_path)
            staged_output = None
        except (ExportProcessError, OSError, ValueError) as exc:
            _remove_incomplete_output(staged_output)
            return ExportResponse(
                accepted=False,
                backend=self.name,
                message=str(exc),
                output_path=str(output_path),
                timings_ms=timings_ms,
            )

        message = f"AVIF gain map export finished at {output_path}"
        if validation:
            message = f"{message}. {validation}"
        return ExportResponse(
            accepted=True,
            backend=self.name,
            message=message,
            output_path=str(output_path),
            timings_ms=timings_ms,
        )


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
        finishing_adjustments = _finishing_adjustments_for_export(session)
        hdr_image = _render_export_branch(session, settings, PreviewKind.HDR, finishing_adjustments)
        sdr_image = _render_export_branch(session, settings, PreviewKind.SDR, finishing_adjustments)

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
                sdr_jpeg_path = temp_dir / "sdr_primary.jpg"
                unfiltered_path = temp_dir / "unfiltered_ultrahdr.jpg"
                exif_payload = _source_exif_payload(session, settings.metadata_policy)
                exif_path = _write_temporary_exif(temp_dir, exif_payload)
                reference_white_nits = getattr(session, "hdr_reference_white_nits", 203)
                hdr_rgba, target_peak_nits = _prepare_hdr_linear_rgba_f16(hdr_image, reference_white_nits)
                hdr_raw_path.write_bytes(hdr_rgba.tobytes(order="C"))
                sdr_rgb = _linear_to_srgb8(sdr_image[..., :3], dither=settings.dithering)
                _write_sdr_rgba8888_pixels(sdr_raw_path, sdr_rgb)
                _write_sdr_jpeg_pixels(
                    sdr_jpeg_path,
                    sdr_rgb,
                    quality=int(settings.quality),
                    chroma_subsampling=settings.jpeg_chroma_subsampling,
                    exif_payload=exif_payload,
                )
                command = _build_ultrahdr_encode_command(
                    ultrahdr_app,
                    hdr_raw_path,
                    sdr_raw_path,
                    unfiltered_path,
                    sdr_jpeg_path=sdr_jpeg_path,
                    exif_path=exif_path,
                    width=int(hdr_image.shape[1]),
                    height=int(hdr_image.shape[0]),
                    quality=int(settings.quality),
                    # The intermediate is decoded for the default denoise pass;
                    # defer the user's requested compression to the final map.
                    gain_map_quality=100,
                    gain_map_scale=settings.jpeg_gain_map_scale,
                    target_peak_nits=target_peak_nits,
                )
                _run_command(command)
                _denoise_ultrahdr_gain_map(
                    unfiltered_path,
                    staged_output,
                    ultrahdr_app,
                    gain_map_quality=int(settings.jpeg_gain_map_quality),
                )

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


class JPEGXLHDRExportBackend(ExportBackend):
    """Encode direct-HDR Rec.2020 PQ JPEG XL at the selected precision."""

    name = "jpegxl_hdr"

    def export(self, session: object, settings: ExportSettings) -> ExportResponse:
        if self.capability.status != CapabilityStatus.AVAILABLE:
            return ExportResponse(accepted=False, backend=self.name, message=self.capability.detail)
        output_path = Path(_resolve_output_path(getattr(session, "session_id", "session"), settings, ".jxl"))
        _require_overwrite_permission(output_path, settings)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        finishing_adjustments = _finishing_adjustments_for_export(session)
        hdr_image = _render_export_branch(session, settings, PreviewKind.HDR, finishing_adjustments)
        staged_output: Path | None = None
        try:
            payload = encode_hdr_jpegxl(
                hdr_image,
                int(settings.quality),
                settings.jpegxl_precision,
                exif_payload=_source_exif_payload(session, settings.metadata_policy),
                reference_white_nits=getattr(session, "hdr_reference_white_nits", 203),
            )
            validation = validate_jpegxl(
                payload, hdr_image.shape[:2], settings.jpegxl_precision
            )
            with NamedTemporaryFile(
                prefix=f".{output_path.stem}.", suffix=".tmp.jxl", dir=output_path.parent, delete=False
            ) as staged_file:
                staged_output = Path(staged_file.name)
                staged_file.write(payload)
                staged_file.flush()
                os.fsync(staged_file.fileno())
            os.replace(staged_output, output_path)
            staged_output = None
        except (JPEGXLError, OSError, ValueError) as exc:
            _remove_incomplete_output(staged_output)
            return ExportResponse(
                accepted=False,
                backend=self.name,
                message=f"JPEG XL HDR export failed: {exc}",
                output_path=str(output_path),
            )
        return ExportResponse(
            accepted=True,
            backend=self.name,
            message=f"JPEG XL HDR exported to {output_path}. {validation}",
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


def _write_sdr_atomic(output_path: Path, suffix: str, writer) -> None:
    """Write a Pillow/imagecodecs SDR file without exposing partial output."""

    staged_output: Path | None = None
    try:
        with NamedTemporaryFile(
            prefix=f".{output_path.stem}.", suffix=f".sdr.tmp{suffix}", dir=output_path.parent, delete=False
        ) as staged_file:
            staged_output = Path(staged_file.name)
        writer(staged_output)
        from PIL import Image

        with Image.open(staged_output) as decoded:
            decoded.verify()
        with staged_output.open("ab") as staged_file:
            os.fsync(staged_file.fileno())
        os.replace(staged_output, output_path)
        staged_output = None
    finally:
        _remove_incomplete_output(staged_output)


def _write_sdr_png(
    path: Path,
    image: np.ndarray,
    *,
    bit_depth: int = 8,
    dithering: str = "off",
    exif_payload: bytes | None = None,
) -> None:
    if bit_depth == 8:
        try:
            from PIL import Image
        except ImportError as exc:
            raise ExportProcessError("Pillow is required to write SDR export intermediates.") from exc
        save_options = {"format": "PNG"}
        if exif_payload:
            save_options["exif"] = exif_payload
        Image.fromarray(_linear_to_srgb8(image, dither=dithering)).save(path, **save_options)
        return
    if bit_depth != 16:
        raise ValueError(f"Unsupported SDR PNG bit depth: {bit_depth}")
    try:
        import imagecodecs

        payload = bytes(imagecodecs.png_encode(_linear_to_srgb16(image)))
    except Exception as exc:
        raise ExportProcessError(f"The 16-bit SDR PNG encoder failed: {exc}") from exc
    if exif_payload:
        payload = _png_with_exif(payload, exif_payload)
    path.write_bytes(payload)


def _write_sdr_jpeg(
    path: Path,
    image: np.ndarray,
    *,
    quality: int,
    chroma_subsampling: str = "420",
    dithering: str = "off",
    exif_payload: bytes | None = None,
) -> None:
    image_8bit = _linear_to_srgb8(image[..., :3], dither=dithering)
    _write_sdr_jpeg_pixels(
        path,
        image_8bit,
        quality=quality,
        chroma_subsampling=chroma_subsampling,
        exif_payload=exif_payload,
    )


def _write_sdr_jpeg_pixels(
    path: Path,
    image_8bit: np.ndarray,
    *,
    quality: int,
    chroma_subsampling: str = "420",
    exif_payload: bytes | None = None,
) -> None:
    """Write already-quantized sRGB pixels without repeating transfer encoding."""
    try:
        from PIL import Image
    except ImportError as exc:
        raise ExportProcessError("Pillow is required to write SDR exports.") from exc

    height, width = image_8bit.shape[:2]
    # Pillow's bundled libjpeg-turbo deliberately reserves a small margin below
    # JPEG's 16-bit SOF limit (65,535), and reports JPEG_MAX_DIMENSION as 65,500.
    max_dimension = 65_500
    if width > max_dimension or height > max_dimension:
        raise ExportProcessError(
            f"SDR JPEG supports dimensions up to {max_dimension:,} pixels with the bundled encoder; "
            f"the finished image is {width:,} x {height:,}. Resize the export or use SDR PNG."
        )
    subsampling_values = {"420": 2, "422": 1, "444": 0}
    try:
        pillow_subsampling = subsampling_values[chroma_subsampling]
    except KeyError as exc:
        raise ValueError(f"Unsupported JPEG chroma subsampling: {chroma_subsampling}") from exc
    try:
        save_options = {
            "format": "JPEG",
            "quality": int(quality),
            "subsampling": pillow_subsampling,
        }
        if exif_payload:
            save_options["exif"] = exif_payload
        Image.fromarray(image_8bit).save(path, **save_options)
    except OSError as exc:
        raise ExportProcessError(f"The SDR JPEG encoder could not write {width:,} x {height:,} pixels: {exc}") from exc


def _linear_to_srgb8(image: np.ndarray, *, dither: bool | str = False) -> np.ndarray:
    clipped = np.clip(image.astype(np.float32, copy=False), 0.0, 1.0)
    srgb = np.where(clipped <= 0.0031308, clipped * 12.92, 1.055 * np.power(clipped, 1.0 / 2.4) - 0.055)
    dither_mode = "auto" if dither is True else "off" if dither is False else str(dither)
    if dither_mode != "off":
        _dither_srgb_in_place(srgb, amplitude_lsb=0.5 if dither_mode == "subtle" else 1.0)
    return np.clip(np.round(srgb * 255.0), 0.0, 255.0).astype(np.uint8)


def _linear_to_srgb16(image: np.ndarray) -> np.ndarray:
    clipped = np.clip(image.astype(np.float32, copy=False), 0.0, 1.0)
    srgb = np.where(clipped <= 0.0031308, clipped * 12.92, 1.055 * np.power(clipped, 1.0 / 2.4) - 0.055)
    return np.clip(np.round(srgb * 65535.0), 0.0, 65535.0).astype(np.uint16)


def _dither_srgb_in_place(
    srgb: np.ndarray, *, amplitude_lsb: float = 1.0, chunk_rows: int = 256
) -> None:
    """Apply decorrelated, repeatable one-LSB RGB dither with bounded scratch memory."""
    height, width, channel_count = srgb.shape
    x = np.arange(width, dtype=np.uint32)[None, :]
    for row_start in range(0, height, chunk_rows):
        row_end = min(height, row_start + chunk_rows)
        y = np.arange(row_start, row_end, dtype=np.uint32)[:, None]
        for channel in range(channel_count):
            channel_seed = np.uint32(((channel + 1) * 0x9E3779B9) & 0xFFFFFFFF)
            value = x * np.uint32(0x1F123BB5) ^ y * np.uint32(0x5F356495) ^ channel_seed
            value ^= value >> np.uint32(16)
            value *= np.uint32(0x7FEB352D)
            value ^= value >> np.uint32(15)
            noise = (
                ((value & np.uint32(0xFFFF)).astype(np.float32) / np.float32(65535.0) - 0.5)
                * np.float32((2.0 * amplitude_lsb) / 255.0)
            )
            srgb[row_start:row_end, :, channel] += noise


def _source_exif_payload(session: object, policy: str) -> bytes | None:
    """Return privacy-filtered source EXIF without touching required codec signaling."""

    if policy == "none":
        return None
    try:
        from PIL import Image

        source_path = Path(getattr(session, "source_path"))
        with Image.open(source_path) as source:
            source_exif = source.getexif()
        if policy == "copyright":
            filtered = Image.Exif()
            for tag in (315, 33432):  # Artist, Copyright
                if source_exif.get(tag):
                    filtered[tag] = source_exif[tag]
        else:
            filtered = Image.Exif()
            filtered.load(source_exif.tobytes())
            # Pixels have already been normalized to display orientation; carrying
            # the source orientation would rotate the finished export a second time.
            for tag in (256, 257, 273, 274, 279):
                filtered.pop(tag, None)
            if policy == "all_except_location":
                filtered.pop(34853, None)  # GPSInfo IFD
        payload = filtered.tobytes()
        return payload if len(filtered) else None
    except (AttributeError, OSError, TypeError, ValueError):
        return None


def _write_temporary_exif(directory: Path, payload: bytes | None) -> Path | None:
    if not payload:
        return None
    path = directory / "source.exif"
    path.write_bytes(payload)
    return path


def _png_with_exif(payload: bytes, exif_payload: bytes) -> bytes:
    signature = b"\x89PNG\r\n\x1a\n"
    if not payload.startswith(signature):
        raise ExportProcessError("The 16-bit PNG encoder returned an invalid stream.")
    tiff_payload = exif_payload[6:] if exif_payload.startswith(b"Exif\x00\x00") else exif_payload
    chunk_type = b"eXIf"
    chunk = (
        len(tiff_payload).to_bytes(4, "big")
        + chunk_type
        + tiff_payload
        + (zlib.crc32(chunk_type + tiff_payload) & 0xFFFFFFFF).to_bytes(4, "big")
    )
    offset = len(signature)
    while offset + 12 <= len(payload):
        length = int.from_bytes(payload[offset : offset + 4], "big")
        if payload[offset + 4 : offset + 8] == b"IEND":
            return payload[:offset] + chunk + payload[offset:]
        offset += 12 + length
    raise ExportProcessError("The 16-bit PNG stream is missing its IEND chunk.")


def _write_sdr_rgba8888(path: Path, image: np.ndarray, *, dithering: str = "auto") -> None:
    # Ultra HDR has an 8-bit JPEG base and an 8-bit gain map. A small,
    # deterministic signal-domain dither prevents long quantization plateaus
    # in smooth gradients before libultrahdr derives and compresses the map.
    rgb = _linear_to_srgb8(image[..., :3], dither=dithering)
    _write_sdr_rgba8888_pixels(path, rgb)


def _write_sdr_rgba8888_pixels(path: Path, rgb: np.ndarray) -> None:
    """Write already-quantized sRGB pixels as libultrahdr's RGBA intent."""
    alpha = np.full((*rgb.shape[:2], 1), 255, dtype=np.uint8)
    rgba = np.concatenate([rgb, alpha], axis=-1)
    path.write_bytes(rgba.tobytes(order="C"))


def _write_hdr_linear_rgba_f16(path: Path, image: np.ndarray, reference_white_nits: int = 203) -> None:
    rgba, _target_peak_nits = _prepare_hdr_linear_rgba_f16(image, reference_white_nits)
    path.write_bytes(rgba.tobytes(order="C"))


def _prepare_hdr_linear_rgba_f16(
    image: np.ndarray, reference_white_nits: int = 203
) -> tuple[np.ndarray, float]:
    """Prepare libultrahdr's HDR intent and measure its peak in one gamut pass."""
    linear_bt2020 = _acescg_to_bt2020_linear(image[..., :3])
    target_peak_nits = _target_hdr_peak_nits_from_bt2020(linear_bt2020, reference_white_nits)
    # libultrahdr's linear API defines 1.0 as 203 nits. Convert once from
    # project scene-linear placement into that codec-interface convention.
    linear_bt2020 = scene_linear_to_nits(linear_bt2020, reference_white_nits) / np.float32(203.0)
    linear_bt2020 = np.nan_to_num(linear_bt2020, nan=0.0, posinf=10000.0 / 203.0, neginf=0.0)
    linear_bt2020 = np.clip(linear_bt2020, 0.0, 10000.0 / 203.0)
    alpha = np.ones((*linear_bt2020.shape[:2], 1), dtype=np.float32)
    rgba = np.concatenate([linear_bt2020, alpha], axis=-1).astype("<f2")
    return rgba, target_peak_nits


def _acescg_to_bt2020_linear(image: np.ndarray) -> np.ndarray:
    try:
        return acescg_to_linear_bt2020(image)
    except ImportError as exc:
        raise ExportProcessError("colour-science is required for JPEG Ultra HDR color conversion.") from exc


def _target_hdr_peak_nits(image: np.ndarray, reference_white_nits: int = 203) -> float:
    bt2020 = np.clip(_acescg_to_bt2020_linear(image[..., :3]), 0.0, None)
    return _target_hdr_peak_nits_from_bt2020(bt2020, reference_white_nits)


def _target_hdr_peak_nits_from_bt2020(bt2020: np.ndarray, reference_white_nits: int = 203) -> float:
    bt2020 = np.clip(bt2020, 0.0, None)
    luma = 0.2627 * bt2020[..., 0] + 0.6780 * bt2020[..., 1] + 0.0593 * bt2020[..., 2]
    peak_nits = float(scene_linear_to_nits(float(np.max(luma, initial=0.0)), reference_white_nits))
    return float(np.clip(peak_nits, 203.0, 10000.0))


def _ultrahdr_content_boost_bounds(target_peak_nits: float) -> tuple[float, float]:
    """Bound an 8-bit publishing gain map without limiting authored HDR headroom.

    Separate SDR/HDR grades can legitimately differ in color as well as luma,
    so the map retains four stops of per-channel latitude around unity. The
    upper bound grows to include the full authored peak when it exceeds that
    latitude. Ratios outside this range predominantly come from division by a
    channel value below the useful precision of the 8-bit SDR base; encoding
    them reduces precision everywhere else and produces visible patching.
    """
    if not np.isfinite(target_peak_nits):
        raise ValueError("Ultra HDR target peak must be finite.")
    target_boost = float(np.clip(target_peak_nits, SDR_WHITE_NITS, 10000.0) / SDR_WHITE_NITS)
    latitude_boost = float(2.0**ULTRAHDR_CHROMATIC_LATITUDE_STOPS)
    return 1.0 / latitude_boost, max(latitude_boost, target_boost)


def _format_cli_float(value: float) -> str:
    return f"{value:.6f}".rstrip("0").rstrip(".")


def _format_metadata_float(value: float) -> str:
    """Retain small gain-map offsets as well as ordinary boost values."""
    return f"{value:.9g}"


def _split_ultrahdr_jpegs(payload: bytes) -> tuple[bytes, bytes]:
    """Return the primary and embedded gain-map JPEG codestreams."""
    primary_end = payload.find(b"\xff\xd9")
    if primary_end < 0:
        raise ExportProcessError("The intermediate Ultra HDR primary is missing its JPEG end marker.")
    primary_end += 2
    gain_start = payload.find(b"\xff\xd8", primary_end)
    gain_end = payload.find(b"\xff\xd9", gain_start)
    if gain_start < 0 or gain_end < 0:
        raise ExportProcessError("The intermediate Ultra HDR file has no embedded gain-map JPEG.")
    return payload[:primary_end], payload[gain_start : gain_end + 2]


def _box_blur_float(values: np.ndarray, radius: int) -> np.ndarray:
    """Small float box blur without adding a SciPy/OpenCV runtime dependency."""
    window = radius * 2 + 1
    horizontal_padding = np.pad(values, ((0, 0), (radius, radius)), mode="edge")
    horizontal_sum = np.pad(
        np.cumsum(horizontal_padding, axis=1, dtype=np.float32),
        ((0, 0), (1, 0)),
        mode="constant",
    )
    horizontal = (horizontal_sum[:, window:] - horizontal_sum[:, :-window]) / np.float32(window)
    vertical_padding = np.pad(horizontal, ((radius, radius), (0, 0)), mode="edge")
    vertical_sum = np.pad(
        np.cumsum(vertical_padding, axis=0, dtype=np.float32),
        ((1, 0), (0, 0)),
        mode="constant",
    )
    return (vertical_sum[window:] - vertical_sum[:-window]) / np.float32(window)


def _guided_filter_gain_map_region(
    guide: np.ndarray,
    gain: np.ndarray,
    *,
    radius: int,
    epsilon: float,
    amount: float,
) -> np.ndarray:
    mean_guide = _box_blur_float(guide, radius)
    variance_guide = _box_blur_float(guide * guide, radius) - mean_guide * mean_guide
    def filter_channel(channel: int) -> np.ndarray:
        source = gain[..., channel]
        mean_source = _box_blur_float(source, radius)
        covariance = _box_blur_float(guide * source, radius) - mean_guide * mean_source
        coefficient = covariance / (variance_guide + np.float32(epsilon))
        intercept = mean_source - coefficient * mean_guide
        return _box_blur_float(coefficient, radius) * guide + _box_blur_float(intercept, radius)

    # The channels are mathematically independent. NumPy releases the GIL for
    # the cumulative sums, so processing them together shortens this CPU-bound
    # post-pass without changing a single per-channel operation or coefficient.
    with ThreadPoolExecutor(max_workers=3, thread_name_prefix="ultrahdr-gain-map") as pool:
        filtered = np.stack(list(pool.map(filter_channel, range(3))), axis=-1)
    return gain + np.float32(amount) * (filtered - gain)


def _denoised_ultrahdr_gain_map_jpeg(
    primary_jpeg: bytes,
    gain_map_jpeg: bytes,
    *,
    quality: int,
    radius: int = ULTRAHDR_GAIN_MAP_DENOISE_RADIUS,
    epsilon: float = ULTRAHDR_GAIN_MAP_DENOISE_EPSILON,
    amount: float = ULTRAHDR_GAIN_MAP_DENOISE_AMOUNT,
    stripe_rows: int = ULTRAHDR_GAIN_MAP_DENOISE_STRIPE_ROWS,
) -> bytes:
    """Denoise log-gain samples, guided by the unchanged SDR primary."""
    try:
        from PIL import Image
    except ImportError as exc:
        raise ExportProcessError("Pillow is required for Ultra HDR gain-map denoising.") from exc
    if not 1 <= quality <= 100:
        raise ValueError("Ultra HDR gain-map quality must be between 1 and 100.")
    if radius < 1 or stripe_rows < 1:
        raise ValueError("Ultra HDR gain-map denoise radius and stripe height must be positive.")

    try:
        with Image.open(BytesIO(gain_map_jpeg)) as encoded_gain:
            gain = encoded_gain.convert("RGB")
        with Image.open(BytesIO(primary_jpeg)) as encoded_primary:
            guide = encoded_primary.convert("L").resize(gain.size, Image.Resampling.LANCZOS)
    except OSError as exc:
        raise ExportProcessError(f"Could not decode the intermediate Ultra HDR gain map: {exc}") from exc

    result = Image.new("RGB", gain.size)
    width, height = gain.size
    # A guided filter contains two radius-wide box-filter stages. Keeping that
    # much overlap makes stripe boundaries numerically equivalent to a single
    # full-frame pass while bounding scratch memory on large RAW exports.
    halo = radius * 2
    for row_start in range(0, height, stripe_rows):
        row_end = min(height, row_start + stripe_rows)
        crop_start = max(0, row_start - halo)
        crop_end = min(height, row_end + halo)
        box = (0, crop_start, width, crop_end)
        gain_region = np.asarray(gain.crop(box), dtype=np.float32) / np.float32(255.0)
        guide_region = np.asarray(guide.crop(box), dtype=np.float32) / np.float32(255.0)
        filtered = _guided_filter_gain_map_region(
            guide_region,
            gain_region,
            radius=radius,
            epsilon=epsilon,
            amount=amount,
        )
        core_start = row_start - crop_start
        core_end = core_start + (row_end - row_start)
        encoded = np.clip(
            np.round(filtered[core_start:core_end] * np.float32(255.0)), 0, 255
        ).astype(np.uint8)
        result.paste(Image.fromarray(encoded), (0, row_start))

    buffer = BytesIO()
    # Multi-channel Ultra HDR maps must retain full chroma resolution.
    result.save(buffer, format="JPEG", quality=int(quality), subsampling=0)
    return buffer.getvalue()


def _ultrahdr_metadata_config(probe_text: str) -> str:
    metadata = parse_jpeg_gain_map_probe(probe_text)
    return "\n".join(
        [
            f"--maxContentBoost {_format_metadata_float(metadata.max_content_boost)}",
            f"--minContentBoost {_format_metadata_float(metadata.min_content_boost)}",
            f"--gamma {_format_metadata_float(metadata.gamma)}",
            f"--offsetSdr {_format_metadata_float(metadata.offset_sdr)}",
            f"--offsetHdr {_format_metadata_float(metadata.offset_hdr)}",
            f"--hdrCapacityMin {_format_metadata_float(metadata.hdr_capacity_min)}",
            f"--hdrCapacityMax {_format_metadata_float(metadata.hdr_capacity_max)}",
            f"--useBaseColorSpace {1 if metadata.use_base_color_space else 0}",
            "",
        ]
    )


def _denoise_ultrahdr_gain_map(
    source_path: Path,
    output_path: Path,
    ultrahdr_app: Path,
    *,
    gain_map_quality: int,
) -> None:
    """Filter only the generated map, then repackage the untouched SDR JPEG."""
    primary_jpeg, gain_map_jpeg = _split_ultrahdr_jpegs(source_path.read_bytes())
    denoised_gain_map = _denoised_ultrahdr_gain_map_jpeg(
        primary_jpeg, gain_map_jpeg, quality=gain_map_quality
    )
    probe = _run_command([str(ultrahdr_app), "-m", "1", "-j", str(source_path), "-P"])
    metadata_config = _ultrahdr_metadata_config(f"{probe.stdout}\n{probe.stderr}")

    with TemporaryDirectory(prefix="hdr_finisher_ultrahdr_denoise_") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        primary_path = temp_dir / "sdr_primary.jpg"
        gain_map_path = temp_dir / "gain_map_denoised.jpg"
        metadata_path = temp_dir / "gain_map_metadata.cfg"
        primary_path.write_bytes(primary_jpeg)
        gain_map_path.write_bytes(denoised_gain_map)
        metadata_path.write_text(metadata_config, encoding="utf-8")
        _run_command(
            [
                str(ultrahdr_app),
                "-m",
                "0",
                "-i",
                str(primary_path),
                "-g",
                str(gain_map_path),
                "-f",
                str(metadata_path),
                "-z",
                str(output_path),
            ]
        )


def _build_ultrahdr_encode_command(
    ultrahdr_app: Path,
    hdr_raw_path: Path,
    sdr_raw_path: Path,
    output_path: Path,
    *,
    sdr_jpeg_path: Path | None = None,
    exif_path: Path | None = None,
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
    min_content_boost, max_content_boost = _ultrahdr_content_boost_bounds(target_peak_nits)
    command = [
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
        "-k",
        _format_cli_float(min_content_boost),
        "-K",
        _format_cli_float(max_content_boost),
        "-D",
        "1",
        "-L",
        _format_cli_float(float(np.clip(target_peak_nits, 203.0, 10000.0))),
    ]
    if sdr_jpeg_path is not None:
        command.extend(["-i", str(sdr_jpeg_path)])
    if exif_path is not None:
        command.extend(["-x", str(exif_path)])
    command.extend(["-z", str(output_path)])
    return command


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


def _write_sdr_y4m(
    path: Path,
    image: np.ndarray,
    *,
    bit_depth: int,
    chroma_subsampling: str,
    dithering: str = "off",
) -> None:
    if bit_depth not in {8, 10, 12}:
        raise ValueError(f"Unsupported AVIF bit depth: {bit_depth}")
    clipped = np.clip(image.astype(np.float32, copy=False), 0.0, 1.0)
    srgb = np.where(clipped <= 0.0031308, clipped * 12.92, 1.055 * np.power(clipped, 1.0 / 2.4) - 0.055)
    if bit_depth == 8 and dithering != "off":
        _dither_srgb_in_place(srgb, amplitude_lsb=0.5 if dithering == "subtle" else 1.0)

    r, g, b = srgb[..., 0], srgb[..., 1], srgb[..., 2]
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    cb = (b - y) / 1.8556
    cr = (r - y) / 1.5748
    scale = float(1 << max(0, bit_depth - 8))
    y_code = np.clip(np.round(16.0 * scale + y * 219.0 * scale), 16.0 * scale, 235.0 * scale)
    cb_code = np.clip(np.round(128.0 * scale + cb * 224.0 * scale), 16.0 * scale, 240.0 * scale)
    cr_code = np.clip(np.round(128.0 * scale + cr * 224.0 * scale), 16.0 * scale, 240.0 * scale)
    dtype = np.uint8 if bit_depth == 8 else np.uint16
    yuv = np.stack([y_code, cb_code, cr_code], axis=-1).astype(dtype)
    _write_y4m_planes(path, yuv, bit_depth=bit_depth, chroma_subsampling=chroma_subsampling)


def _write_hdr_y4m(
    path: Path,
    image: np.ndarray,
    *,
    bit_depth: int = 10,
    chroma_subsampling: str = "444",
    reference_white_nits: int = 203,
) -> None:
    if bit_depth not in {8, 10, 12}:
        raise ValueError(f"Unsupported AVIF bit depth: {bit_depth}")
    if chroma_subsampling not in {"420", "422", "444"}:
        raise ValueError(f"Unsupported AVIF chroma subsampling: {chroma_subsampling}")
    yuv = _linear_to_bt2020_pq_yuv(image, bit_depth, reference_white_nits)
    _write_y4m_planes(path, yuv, bit_depth=bit_depth, chroma_subsampling=chroma_subsampling)


def _write_y4m_planes(
    path: Path,
    yuv: np.ndarray,
    *,
    bit_depth: int,
    chroma_subsampling: str,
) -> None:
    height, width = yuv.shape[:2]
    chroma_name = (
        {"420": "420jpeg", "422": "422", "444": "444"}[chroma_subsampling]
        if bit_depth == 8
        else f"{chroma_subsampling}p{bit_depth}"
    )
    xyscss = chroma_name.upper() if bit_depth == 8 else f"{chroma_subsampling.upper()}P{bit_depth}"
    header = (
        f"YUV4MPEG2 W{width} H{height} F1:1 Ip A1:1 C{chroma_name} "
        f"XYSCSS={xyscss}\n"
    ).encode("ascii")
    frame_header = b"FRAME\n"

    with path.open("wb") as handle:
        handle.write(header)
        handle.write(frame_header)
        planes = [yuv[..., 0]]
        if chroma_subsampling == "444":
            planes.extend([yuv[..., 1], yuv[..., 2]])
        elif chroma_subsampling == "422":
            planes.extend([_downsample_plane(yuv[..., 1], 1, 2), _downsample_plane(yuv[..., 2], 1, 2)])
        else:
            planes.extend([_downsample_plane(yuv[..., 1], 2, 2), _downsample_plane(yuv[..., 2], 2, 2)])
        dtype = np.uint8 if bit_depth == 8 else np.dtype("<u2")
        for plane in planes:
            handle.write(plane.astype(dtype, copy=False).tobytes())


def _linear_to_pq_rgb10(image: np.ndarray, reference_white_nits: int = 203) -> np.ndarray:
    return _linear_to_pq_rgb(image, 10, reference_white_nits)


def _linear_to_pq_rgb(image: np.ndarray, bit_depth: int, reference_white_nits: int = 203) -> np.ndarray:
    linear = np.clip(image.astype(np.float32, copy=False), 0.0, None)
    nits = np.clip(scene_linear_to_nits(linear, reference_white_nits), 0.0, 10000.0)
    pq = _pq_oetf(nits / 10000.0)
    maximum = float((1 << bit_depth) - 1)
    dtype = np.uint8 if bit_depth == 8 else np.uint16
    return np.clip(np.round(pq * maximum), 0.0, maximum).astype(dtype)


def _linear_to_bt2020_pq_yuv10(image: np.ndarray, reference_white_nits: int = 203) -> np.ndarray:
    return _linear_to_bt2020_pq_yuv(image, 10, reference_white_nits)


def _linear_to_bt2020_pq_yuv(image: np.ndarray, bit_depth: int, reference_white_nits: int = 203) -> np.ndarray:
    linear_bt2020 = _acescg_to_bt2020_linear(image)
    maximum = float((1 << bit_depth) - 1)
    pq_rgb = _linear_to_pq_rgb(linear_bt2020, bit_depth, reference_white_nits).astype(np.float32) / maximum

    r = pq_rgb[..., 0]
    g = pq_rgb[..., 1]
    b = pq_rgb[..., 2]

    kr = np.float32(0.2627)
    kb = np.float32(0.0593)
    kg = np.float32(1.0 - kr - kb)

    y = kr * r + kg * g + kb * b
    cb = (b - y) / (2.0 * (1.0 - kb))
    cr = (r - y) / (2.0 * (1.0 - kr))

    scale = float(1 << max(0, bit_depth - 8))
    y_min, y_span, y_max = 16.0 * scale, 219.0 * scale, 235.0 * scale
    c_min, c_span, c_mid, c_max = 16.0 * scale, 224.0 * scale, 128.0 * scale, 240.0 * scale
    y_code = np.clip(np.round(y_min + y * y_span), y_min, y_max)
    cb_code = np.clip(np.round(c_mid + cb * c_span), c_min, c_max)
    cr_code = np.clip(np.round(c_mid + cr * c_span), c_min, c_max)
    dtype = np.uint8 if bit_depth == 8 else np.uint16
    return np.stack([y_code, cb_code, cr_code], axis=-1).astype(dtype)


def _downsample_plane(plane: np.ndarray, vertical: int, horizontal: int) -> np.ndarray:
    height, width = plane.shape
    padded_height = ((height + vertical - 1) // vertical) * vertical
    padded_width = ((width + horizontal - 1) // horizontal) * horizontal
    padded = np.pad(plane, ((0, padded_height - height), (0, padded_width - width)), mode="edge")
    return np.round(
        padded.reshape(padded_height // vertical, vertical, padded_width // horizontal, horizontal)
        .mean(axis=(1, 3))
    ).astype(plane.dtype)


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
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            **hidden_window_options(),
        )
    except OSError as exc:
        raise ExportProcessError(f"Could not start {Path(command[0]).name}: {exc}") from exc
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or f"Command failed with exit code {result.returncode}."
        raise ExportProcessError(detail)
    return result


def _validate_avif_output(
    path: Path,
    *,
    expected_bit_depth: int | None = None,
    expected_chroma: str | None = None,
    expected_gain_map_chroma: str | None = None,
) -> str | None:
    avifdec = resolve_binary("avifdec")
    if avifdec is None:
        return None
    result = subprocess.run(
        [str(avifdec), "--info", str(path)],
        capture_output=True,
        text=True,
        check=False,
        **hidden_window_options(),
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "avifdec could not decode the result."
        raise ExportProcessError(f"AVIF validation failed: {detail}")
    if "Gain map" not in result.stdout or "Gain map       : Absent" in result.stdout:
        raise ExportProcessError("AVIF validation did not find an embedded gain map.")
    if expected_bit_depth is not None and f"Bit Depth      : {expected_bit_depth}" not in result.stdout:
        raise ExportProcessError("AVIF validation did not preserve the selected primary bit depth.")
    if expected_chroma is not None and f"Format         : YUV{expected_chroma}" not in result.stdout:
        raise ExportProcessError("AVIF validation did not preserve the selected chroma subsampling.")
    if expected_gain_map_chroma is not None and f"YUV{expected_gain_map_chroma}" not in result.stdout:
        raise ExportProcessError("AVIF validation did not preserve the selected gain-map chroma subsampling.")
    return "Validated with avifdec."


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
        "jpegxl_hdr": JPEGXLHDRExportBackend(capabilities["jpegxl_export"]),
        "sdr_jpegxl": SDRJPEGXLExportBackend(capabilities["jpegxl_export"]),
        "sdr_jpeg": SDRJPEGExportBackend(capabilities["pillow"]),
        "sdr_png": SDRPNGExportBackend(capabilities["pillow"]),
    }
