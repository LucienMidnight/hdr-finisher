from __future__ import annotations

import atexit
from contextlib import closing, nullcontext, suppress
from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory, mkdtemp
from threading import Lock, RLock
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import numpy as np

from .avif_info import inspect_avif
from .binaries import resolve_binary
from .color import acescg_to_linear_bt2020, linear_bt2020_to_acescg, linear_srgb_to_acescg
from .color_context import RenderColorContext, nits_to_scene_linear, scene_linear_to_nits
from .config import APP_VERSION
from .delivery_frames import DeliveryFrame, row_bands
from .exporters import (
    ExportBackend, _finishing_adjustments_for_export, _render_delivery_files,
    _render_export_branch, _run_command,
    denoise_delivery_key, share_delivery_grain,
)
from .gainmap_decoders import parse_jpeg_gain_map_probe
from .models import (
    JPEGGainMapProofMetadata,
    PreviewKind,
    ProofArtifactRequest,
    ProofArtifactResponse,
    ProofMatrixResponse,
    ProofMatrixTile,
    ProofReconstructionRequest,
    ProofReconstructionResponse,
)
from .jpegxl import inspect_jpegxl
from .preview import _encode_hdr_avif, _encode_hdr_avif_y4m, _write_hdr_y4m_bands
from .finishing import geometry_output_dimensions


PROOF_FORMAT_INFO = {
    "jpeg_ultrahdr": (".jpg", "image/jpeg"),
    "avif_gain_map": (".avif", "image/avif"),
    "jpegxl_hdr": (".jxl", "image/jxl"),
}
SUPPORTED_PROOF_FORMATS = set(PROOF_FORMAT_INFO)
MATRIX_HEADROOMS = (0.0, 1.0, 2.0, 3.0, 4.0)
# Proof tiles are a measurement surface, not a delivery artifact. Encode them
# well above the interactive preview's quality so what the tile shows is the
# reconstruction and not the tile encoder.
PROOF_TILE_QUALITY = 95
_PROOF_RECONSTRUCTION_ROWS = 128


@dataclass
class ProofArtifact:
    artifact_id: str
    format: str
    path: Path
    media_type: str
    sha256: str
    width: int
    height: int
    quality: int
    metadata_summary: str
    encoded_headroom: float
    reference_white_nits: int
    hdr_authored: np.ndarray | DeliveryFrame | None
    sdr_authored: np.ndarray | DeliveryFrame | None
    jpeg_gain_map: JPEGGainMapProofMetadata | None = None
    full_size: bool = False
    exact_measurements: dict | None = None
    renderer: str = "cpu"
    fallback_reason: str | None = None
    delivery_cache: tuple | None = None
    delivery_notes: tuple[str, ...] = ()
    jpeg_decoded: Path | None = None
    jpeg_gain_range: tuple[np.ndarray, np.ndarray] | None = None
    authored_gain_range: tuple[np.ndarray, np.ndarray] | None = None
    endpoint_storage: TemporaryDirectory | None = None


@dataclass
class ProofTile:
    tile_id: str
    path: Path
    media_type: str


@dataclass(frozen=True)
class GainMapParameters:
    display_ratio_sdr: float
    display_ratio_hdr: float
    gain_min: np.ndarray
    gain_max: np.ndarray
    gamma: np.ndarray
    epsilon_sdr: np.ndarray
    epsilon_hdr: np.ndarray


def apply_gain_map_formula(
    base: np.ndarray,
    gain_map: np.ndarray,
    parameters: GainMapParameters,
    display_headroom: float,
) -> np.ndarray:
    """Apply the Skia/ISO gain-map formula in linear light.

    ``display_headroom`` is log2(H), matching the UI and libavif tooling.
    """
    h = float(2.0 ** max(0.0, display_headroom))
    denominator = math.log(max(parameters.display_ratio_hdr, 1.0 + 1e-8)) - math.log(
        max(parameters.display_ratio_sdr, 1e-8)
    )
    if abs(denominator) < 1e-8:
        weight = 1.0 if h >= parameters.display_ratio_hdr else 0.0
    else:
        weight = float(
            np.clip(
                (math.log(h) - math.log(max(parameters.display_ratio_sdr, 1e-8))) / denominator,
                0.0,
                1.0,
            )
        )
    encoded_gain = np.clip(gain_map.astype(np.float32, copy=False), 0.0, 1.0)
    log_boost = parameters.gain_min + (
        parameters.gain_max - parameters.gain_min
    ) * np.power(encoded_gain, parameters.gamma)
    result = (base.astype(np.float32, copy=False) + parameters.epsilon_sdr) * np.exp(
        log_boost * np.float32(weight)
    ) - parameters.epsilon_hdr
    return np.nan_to_num(result, nan=0.0, posinf=65504.0, neginf=0.0).clip(0.0)


def reconstruct_from_endpoints(
    base: np.ndarray,
    alternate: np.ndarray,
    encoded_headroom: float,
    target: float,
    *,
    display_ratio_sdr: float = 1.0,
    offset_sdr: float = 1.0 / 64.0,
    offset_hdr: float = 1.0 / 64.0,
) -> np.ndarray:
    """Build an ISO-equivalent gain map from decoded endpoints and apply it."""
    epsilon_sdr = np.float32(offset_sdr)
    epsilon_hdr = np.float32(offset_hdr)
    base_rgb = np.clip(base[..., :3].astype(np.float32, copy=False), 0.0, None)
    alternate_rgb = np.clip(alternate[..., :3].astype(np.float32, copy=False), 0.0, None)
    log_gain = _endpoint_log_gain(base_rgb, alternate_rgb, epsilon_sdr, epsilon_hdr)
    gain_min = np.min(log_gain, axis=(0, 1)).astype(np.float32)
    gain_max = np.max(log_gain, axis=(0, 1)).astype(np.float32)
    parameters = _endpoint_gain_parameters(encoded_headroom, display_ratio_sdr, epsilon_sdr,
                                           epsilon_hdr, gain_min, gain_max)
    return _apply_endpoint_gain(base_rgb, log_gain, parameters, target)


def _endpoint_log_gain(base, alternate, offset_sdr, offset_hdr):
    return np.log(alternate + offset_hdr) - np.log(base + offset_sdr)


def _endpoint_gain_range(log_gain_bands):
    # Match the whole-frame channel extrema, including NaN propagation.
    gain_min = np.full(3, np.inf, dtype=np.float32)
    gain_max = np.full(3, -np.inf, dtype=np.float32)
    for log_gain in log_gain_bands:
        gain_min = np.minimum(gain_min, np.min(log_gain, axis=(0, 1)))
        gain_max = np.maximum(gain_max, np.max(log_gain, axis=(0, 1)))
    return gain_min, gain_max


def _authored_log_gain_bands(base, alternate, offset_sdr, offset_hdr):
    with (closing(row_bands(base, _PROOF_RECONSTRUCTION_ROWS)) as sdr_bands,
          closing(row_bands(alternate, _PROOF_RECONSTRUCTION_ROWS)) as hdr_bands):
        for base_band, hdr_band in zip(sdr_bands, hdr_bands, strict=True):
            base_rgb = np.clip(base_band[..., :3].astype(np.float32, copy=False), 0.0, None)
            alternate_rgb = np.clip(hdr_band[..., :3].astype(np.float32, copy=False), 0.0, None)
            yield base_rgb, _endpoint_log_gain(base_rgb, alternate_rgb, offset_sdr, offset_hdr)


def _sdr_matrix_band(pixels):
    encoded_sdr_linear = np.clip(pixels[..., :3], 0, 1)
    return np.clip(linear_srgb_to_acescg(encoded_sdr_linear) * np.float32(0.18), 0, None)


def _endpoint_gain_parameters(encoded_headroom, display_ratio_sdr, offset_sdr, offset_hdr, gain_min, gain_max):
    return GainMapParameters(
        display_ratio_sdr=max(float(display_ratio_sdr), 1e-8),
        display_ratio_hdr=float(2.0 ** max(encoded_headroom, 0.0)),
        gain_min=gain_min,
        gain_max=gain_max,
        gamma=np.ones((3,), dtype=np.float32),
        epsilon_sdr=np.full((3,), offset_sdr, dtype=np.float32),
        epsilon_hdr=np.full((3,), offset_hdr, dtype=np.float32),
    )


def _apply_endpoint_gain(base, log_gain, parameters, target):
    span = np.maximum(parameters.gain_max - parameters.gain_min, np.float32(1e-6))
    normalized = np.clip((log_gain - parameters.gain_min) / span, 0.0, 1.0)
    return apply_gain_map_formula(base, normalized, parameters, target)


def _jpeg_base_endpoint(rgb):
    srgb = np.asarray(rgb, dtype=np.float32) / np.float32(255.0)
    linear_srgb = np.where(srgb <= 0.04045, srgb / 12.92, np.power((srgb + 0.055) / 1.055, 2.4))
    return np.clip(linear_srgb_to_acescg(linear_srgb) * np.float32(0.18), 0.0, None)


def _jpeg_alternate_endpoint(rgba, reference_white_nits, use_base_color_space):
    # libultrahdr linear output uses 1.0 == 203 nits.
    decoded = rgba[..., :3].astype(np.float32) * np.float32(203.0)
    decoded = nits_to_scene_linear(decoded, reference_white_nits)
    transform = linear_srgb_to_acescg if use_base_color_space else linear_bt2020_to_acescg
    return np.clip(transform(decoded), 0.0, None)


def _jpeg_endpoint_bands(primary, raw, artifact):
    use_base = artifact.jpeg_gain_map is None or artifact.jpeg_gain_map.use_base_color_space
    raw.seek(0)
    for top in range(0, artifact.height, 128):
        bottom = min(top + 128, artifact.height)
        rgb = primary.crop((0, top, artifact.width, bottom))
        if rgb.mode != "RGB":
            rgb = rgb.convert("RGB")
        rgba = np.fromfile(raw, dtype="<f2", count=(bottom - top) * artifact.width * 4)
        rgba = rgba.reshape(bottom - top, artifact.width, 4)
        yield _jpeg_base_endpoint(rgb), _jpeg_alternate_endpoint(rgba, artifact.reference_white_nits, use_base)


class ProofArtifactStore:
    def __init__(self) -> None:
        self.root = Path(mkdtemp(prefix="hdr_finisher_proof_", dir=os.environ.get("HDR_FINISHER_PROOF_ROOT")))
        self._lock = RLock()
        self._artifacts: dict[str, ProofArtifact] = {}
        self._tiles: dict[str, ProofTile] = {}
        self._request_cache: dict[str, str] = {}
        self._target_cache: dict[str, ProofMatrixTile] = {}
        self._endpoint_cache: dict[str, tuple[np.ndarray, np.ndarray]] = {}
        self._endpoint_locks = {}
        self._full_tile_lock = Lock()
        atexit.register(self.clear)

    def clear(self) -> None:
        with self._full_tile_lock, self._lock:
            self._artifacts.clear()
            self._tiles.clear()
            self._request_cache.clear()
            self._target_cache.clear()
            self._endpoint_cache.clear()
            self._endpoint_locks.clear()
        shutil.rmtree(self.root, ignore_errors=True)

    def create(
        self,
        session: object,
        request: ProofArtifactRequest,
        backend: ExportBackend,
    ) -> ProofArtifactResponse:
        if request.format not in SUPPORTED_PROOF_FORMATS:
            raise ValueError(f"Unsupported proof format: {request.format}")
        context = getattr(session, "color_context", RenderColorContext(getattr(session, "hdr_reference_white_nits", 203)))
        denoise = getattr(session, "denoise", None)
        signature = self._request_signature(getattr(session, "session_id"), request, context, denoise,
            source_epoch=getattr(getattr(session, "render_cache", None), "source_epoch", 0),
            framing=getattr(session, "framing", None),
            local_adjustments=request.adjustments.enabled_locals(getattr(session, "local_adjustments", None)))
        if not request.force:
            with self._lock:
                cached_id = self._request_cache.get(signature)
                cached = self._artifacts.get(cached_id or "")
                if cached is not None and cached.path.exists():
                    if cached.delivery_cache is not None:
                        session._delivery_cache = cached.delivery_cache
                        session._delivery_record = cached.delivery_cache[2]
                    return self._response(cached, request.editing_measurements)

        render_cache = getattr(session, "render_cache")
        if request.full_size:
            # The export grades ``session.image``. A full-size proof has to
            # grade that same array, not a level the cache answers for an edge.
            source = getattr(session, "image", render_cache.image)
            sdr_reference = getattr(session, "sdr_reference_image", render_cache.sdr_reference_image)
        else:
            source, sdr_reference = render_cache.source_pair(request.long_edge)
        full_size = bool(request.full_size or source.shape[:2] == render_cache.image.shape[:2])
        proxy_session = SimpleNamespace(
            session_id=f"proof-{getattr(session, 'session_id', 'session')}",
            delivery_owner=session,
            image=source,
            sdr_reference_image=sdr_reference,
            adjustments=request.adjustments,
            hdr_reference_white_nits=context.hdr_reference_white_nits,
            color_context=context,
            local_adjustments=request.adjustments.enabled_locals(getattr(session, "local_adjustments", None)),
            # Denoise is authored beside the grade, and the export graph reads it
            # from the session. A proof that claims to show the delivered file
            # must carry it too, or a denoised edit would be reviewed through a
            # file the export endpoint would never produce.
            denoise=denoise,
            framing=getattr(session, "framing", None),
            framing_source_size=geometry_output_dimensions(
                render_cache.image.shape[1], render_cache.image.shape[0], request.adjustments.shared.geometry),
            framing_output_limit=None if request.full_size else request.long_edge,
        )
        if full_size and not request.full_size and request.export_with_frame and getattr(session, "framing", None):
            from .photo_framing import output_layout
            native = output_layout(*proxy_session.framing_source_size, session.framing, request.output_finishing)
            full_size = max(native.width, native.height) <= request.long_edge
        if full_size and request.format != "jpeg_ultrahdr":
            storage = TemporaryDirectory(prefix="endpoints-", dir=self.root, ignore_cleanup_errors=True)
            try:
                return self._build_artifact(proxy_session, request, backend, signature, context, full_size, storage)
            except BaseException:
                with suppress(OSError):
                    storage.cleanup()
                raise
        grain = (share_delivery_grain(proxy_session, request.adjustments, spans_encoding=True)
                 if request.format != "jpeg_ultrahdr" else nullcontext())
        with grain:
            return self._build_artifact(proxy_session, request, backend, signature, context, full_size)

    def _build_artifact(self, proxy_session, request, backend, signature, context, full_size, storage=None):
        suffix, media_type = PROOF_FORMAT_INFO[request.format]
        # Proofs are internal cache artifacts, not user exports. Use a unique
        # staging target so concurrent/retried builds cannot collide, and allow
        # the exporter to replace that owned target if it created a partial file.
        staged = self.root / f"request-{signature}-{uuid4().hex}{suffix}"
        export_settings = request.to_export_settings(str(staged))
        if storage is not None:
            object.__setattr__(export_settings, "_proof_endpoint_directory", Path(storage.name))
        elif request.format == "avif_gain_map":
            object.__setattr__(export_settings, "_keep_proof_delivery_cache", True)
        if full_size:
            export_settings.editing_measurements = {lane: {"peak": 0, "anchor": 0} for lane in ("hdr", "sdr")}
        try:
            result = backend.export(
                proxy_session,
                export_settings,
            )
            if not result.accepted or not result.output_path:
                raise RuntimeError(result.message)
            output_path = Path(result.output_path)
            with output_path.open("rb") as payload:
                digest = hashlib.file_digest(payload, "sha256").hexdigest()
            artifact_id = digest[:24]
            final_path = self.root / f"{artifact_id}{suffix}"
            if output_path != final_path:
                # The name is the content digest, so two builds of the same
                # grade race for the same destination. Checking existence first
                # leaves a window where both see it missing and both rename;
                # on Windows the loser is denied because the winner already
                # holds the file open for inspection. Losing that race means
                # the identical bytes are already on disk, so treat it as a hit.
                try:
                    output_path.replace(final_path)
                except OSError:
                    if not final_path.exists():
                        raise
                    output_path.unlink(missing_ok=True)
        finally:
            # Cleanup must never hide the encoder/inspection failure that the UI
            # needs to report. A unique future stage also makes a locked remnant harmless.
            with suppress(OSError):
                staged.unlink(missing_ok=True)

        encoded_headroom, metadata_summary = _inspect_artifact(final_path, request.format, context.hdr_reference_white_nits)
        jpeg_gain_map = None
        if request.format == "jpeg_ultrahdr":
            try:
                jpeg_gain_map = _inspect_jpeg_gain_map(final_path)
            except (OSError, ValueError, RuntimeError):
                jpeg_gain_map = _default_jpeg_gain_map_metadata(encoded_headroom)
        jpeg_decoded = None
        hdr_authored = sdr_matrix_endpoint = None
        if full_size and request.format == "jpeg_ultrahdr":
            # The real JPEG endpoints drive reconstruction. Only render the
            # authored fallback if the native decoder cannot provide them.
            from PIL import Image

            try:
                with Image.open(final_path) as primary:
                    width, height = primary.size
                    primary.load()
                    primary.close()
                with self._lock:
                    endpoint_lock = self._endpoint_locks.setdefault(artifact_id, Lock())
                with endpoint_lock:
                    jpeg_decoded = self._decode_jpeg_endpoint(final_path, artifact_id, width, height)
            except (OSError, ValueError, RuntimeError):
                pass
        if storage is not None:
            endpoints = getattr(export_settings, "_proof_endpoints", None)
            directory = Path(storage.name)
            if endpoints is None:
                adjustments = _finishing_adjustments_for_export(proxy_session)
                endpoints = _render_delivery_files(proxy_session, export_settings, adjustments, directory,
                                                   render=_render_export_branch)
            hdr_authored, sdr_authored = endpoints
            height, width = hdr_authored.shape[:2]
            sdr_matrix_endpoint = DeliveryFrame(directory / "sdr-matrix.rgb", (height, width, 3))
            with closing(sdr_authored.bands(_PROOF_RECONSTRUCTION_ROWS)) as bands:
                sdr_matrix_endpoint.write(_sdr_matrix_band(band) for band in bands)
            sdr_authored.path.unlink()
        elif jpeg_decoded is None:
            finishing_adjustments = _finishing_adjustments_for_export(proxy_session)
            hdr_authored = _render_export_branch(proxy_session, export_settings, PreviewKind.HDR, finishing_adjustments)
            sdr_authored = _render_export_branch(proxy_session, export_settings, PreviewKind.SDR, finishing_adjustments)
            # The SDR branch is display-linear sRGB where 1.0 is reference white.
            # Matrix rendering uses the HDR working convention where 0.18 is
            # 100-nit diffuse white, so normalize the endpoint before applying a
            # gain map or encoding a PQ tile.
            # A CPU strip result is a unique output owned by this build. Reuse it
            # after rendering: it is never the source or a cached GPU lane. Convert
            # in bands instead of holding three more native SDR frames at once.
            reuse = (result.renderer == "cpu" and sdr_authored.flags.owndata
                     and getattr(export_settings, "_last_cpu_strips", False))
            sdr_matrix_endpoint = sdr_authored if reuse else np.empty_like(sdr_authored)
            if reuse:
                sdr_matrix_endpoint.setflags(write=True)
            for row in range(0, sdr_authored.shape[0], 128):
                sdr_matrix_endpoint[row:row + 128] = _sdr_matrix_band(sdr_authored[row:row + 128])
            sdr_matrix_endpoint.setflags(write=False)
            height, width = hdr_authored.shape[:2]
            hdr_authored = np.ascontiguousarray(hdr_authored, dtype=np.float32)
            sdr_matrix_endpoint = np.ascontiguousarray(sdr_matrix_endpoint, dtype=np.float32)
        artifact = ProofArtifact(
            artifact_id=artifact_id,
            format=request.format,
            path=final_path,
            media_type=media_type,
            sha256=digest,
            width=int(width),
            height=int(height),
            quality=request.quality,
            metadata_summary=metadata_summary,
            encoded_headroom=encoded_headroom,
            reference_white_nits=context.hdr_reference_white_nits,
            hdr_authored=hdr_authored,
            sdr_authored=sdr_matrix_endpoint,
            jpeg_decoded=jpeg_decoded,
            jpeg_gain_map=jpeg_gain_map,
            full_size=full_size,
            exact_measurements=export_settings._exact_measurements if full_size else None,
            renderer=result.renderer,
            delivery_notes=tuple(result.delivery_notes),
            fallback_reason=result.fallback_reason,
            delivery_cache=getattr(proxy_session, "_delivery_cache", None),
            endpoint_storage=storage,
        )
        with self._full_tile_lock, self._lock:
            previous = self._artifacts.pop(artifact_id, None)
            if previous is not None and previous.endpoint_storage is not None:
                previous.endpoint_storage.cleanup()
            self._artifacts[artifact_id] = artifact
            self._request_cache[signature] = artifact_id
            retained = [item for item in self._artifacts.values() if item.endpoint_storage is not None]
            for item in retained[:-2]:
                item.endpoint_storage.cleanup()
                item.endpoint_storage = None
                item.hdr_authored = item.sdr_authored = None
                self._request_cache = {key: value for key, value in self._request_cache.items()
                                       if value != item.artifact_id}
        return self._response(artifact, request.editing_measurements)

    def artifact(self, artifact_id: str) -> ProofArtifact:
        with self._lock:
            artifact = self._artifacts.get(artifact_id)
        if artifact is None or not artifact.path.exists():
            raise KeyError(f"Proof artifact '{artifact_id}' was not found.")
        return artifact

    def tile(self, tile_id: str) -> ProofTile:
        with self._lock:
            tile = self._tiles.get(tile_id)
        if tile is None or not tile.path.exists():
            raise KeyError(f"Proof tile '{tile_id}' was not found.")
        return tile

    def matrix(self, artifact_id: str, display_headroom: float | None) -> ProofMatrixResponse:
        artifact = self.artifact(artifact_id)
        targets = list(MATRIX_HEADROOMS)
        full = max(0.0, artifact.encoded_headroom)
        if not any(abs(item - full) < 0.01 for item in targets):
            targets.append(full)
        tiles: list[ProofMatrixTile] = []
        for target in targets:
            label = "Full" if abs(target - full) < 0.01 and target not in MATRIX_HEADROOMS else f"+{target:g} stops"
            tiles.append(self._target_tile(artifact, target, label, display_headroom))
        return ProofMatrixResponse(
            artifact_id=artifact.artifact_id,
            encoded_headroom=round(artifact.encoded_headroom, 4),
            reconstruction=(
                "Encoded AVIF gain map tone-mapped by libavif"
                if artifact.format == "avif_gain_map"
                else "Encoded JPEG endpoints reconstructed with ISO/Skia weighting"
            ),
            tiles=tiles,
        )

    def reconstruction(
        self,
        request: ProofReconstructionRequest,
        displays: list[dict[str, Any]],
    ) -> ProofReconstructionResponse:
        artifact = self.artifact(request.artifact_id)
        display = _select_proof_display(displays, request.target.display_id)
        display_headroom = _optional_float(display.get("nominal_headroom")) if display else None
        display_max_nits = _optional_float(display.get("max_luminance_nits")) if display else None

        if request.target.mode == "auto":
            if display is None or display_headroom is None:
                raise ValueError("Automatic proofing is unavailable because display headroom could not be read.")
            requested_headroom = max(0.0, display_headroom)
            requested_peak_nits = display_max_nits
            target_label = f"Auto · {display.get('name') or 'current display'}"
        elif request.target.mode == "fixed":
            requested_peak_nits = float(request.target.peak_nits or 1000.0)
            requested_headroom = target_headroom_for_peak_nits(requested_peak_nits, artifact.reference_white_nits)
            target_label = f"{requested_peak_nits:g} nits"
        else:
            requested_headroom = max(0.0, artifact.encoded_headroom)
            requested_peak_nits = None
            target_label = "Full encoded range"

        encoded_headroom = max(0.0, artifact.encoded_headroom)
        resolved_headroom = min(requested_headroom, encoded_headroom)
        capped = requested_headroom > encoded_headroom + 0.0001
        tile = self._target_tile(artifact, resolved_headroom, target_label, display_headroom)
        reconstruction = self._reconstruction_label(artifact)
        return ProofReconstructionResponse(
            artifact_id=artifact.artifact_id,
            format=artifact.format,
            target_mode=request.target.mode,
            target_label=target_label,
            requested_headroom=round(requested_headroom, 4),
            resolved_headroom=round(resolved_headroom, 4),
            requested_peak_nits=round(requested_peak_nits, 1) if requested_peak_nits is not None else None,
            resolved_reference_peak_nits=round(artifact.reference_white_nits * (2.0 ** resolved_headroom), 1),
            encoded_headroom=round(encoded_headroom, 4),
            capped_by_encoded_headroom=capped,
            display_id=str(display.get("id")) if display else None,
            display_label=str(display.get("name")) if display else None,
            display_headroom=round(display_headroom, 4) if display_headroom is not None else None,
            display_max_luminance_nits=round(display_max_nits, 1) if display_max_nits is not None else None,
            display_can_represent=(resolved_headroom <= display_headroom + 0.05) if display_headroom is not None else None,
            reconstruction=reconstruction,
            cache_id=f"{artifact.artifact_id}:{resolved_headroom:.6f}",
            tile=tile,
        )

    def _target_tile(
        self,
        artifact: ProofArtifact,
        target: float,
        label: str,
        display_headroom: float | None,
    ) -> ProofMatrixTile:
        resolved_target = min(max(float(target), 0.0), max(artifact.encoded_headroom, 0.0))
        cache_key = f"{artifact.artifact_id}:{resolved_target:.6f}"
        # The two UI targets arrive together. Serialize full-size tile builds
        # so their reconstruction and native encoders cannot overlap.
        with self._full_tile_lock if artifact.full_size else nullcontext():
            with self._lock:
                cached = self._target_cache.get(cache_key)
                if artifact.full_size:
                    artifact = self._artifacts.get(artifact.artifact_id, artifact)
            if cached is None:
                if artifact.jpeg_decoded is not None:
                    tile_bytes, peak_nits, clipped = self._jpeg_target_tile(artifact, resolved_target)
                elif artifact.full_size and artifact.format != "jpeg_ultrahdr":
                    if artifact.hdr_authored is None:
                        raise KeyError("The Proof endpoints have expired. Refresh Proof to render them again.")
                    tile_bytes, peak_nits, clipped = self._authored_target_tile(artifact, resolved_target)
                else:
                    base_endpoint, alternate_endpoint = self._matrix_endpoints(artifact)
                    reconstructed = reconstruct_from_endpoints(
                        base_endpoint,
                        alternate_endpoint,
                        max(artifact.encoded_headroom, 0.01),
                        resolved_target,
                        display_ratio_sdr=(artifact.jpeg_gain_map.hdr_capacity_min if artifact.jpeg_gain_map else 1.0),
                        offset_sdr=(artifact.jpeg_gain_map.offset_sdr if artifact.jpeg_gain_map else 1.0 / 64.0),
                        offset_hdr=(artifact.jpeg_gain_map.offset_hdr if artifact.jpeg_gain_map else 1.0 / 64.0),
                    )
                    tile_bytes = self._encoded_matrix_tile(artifact, resolved_target, reconstructed)
                    peak_nits, clipped = _image_stats(reconstructed, resolved_target, artifact.reference_white_nits)
                tile_hash = hashlib.sha256(tile_bytes).hexdigest()
                tile_id = tile_hash[:24]
                tile_path = self.root / f"tile-{tile_id}.avif"
                if not tile_path.exists():
                    tile_path.write_bytes(tile_bytes)
                with self._lock:
                    self._tiles[tile_id] = ProofTile(tile_id=tile_id, path=tile_path, media_type="image/avif")
                cached = ProofMatrixTile(
                    id=tile_id,
                    label=label,
                    target_headroom=round(resolved_target, 4),
                    url=f"/api/proof/tile/{tile_id}.avif",
                    peak_nits=round(peak_nits, 1),
                    clipped_percent=round(clipped, 3),
                    above_display_headroom=None,
                )
                with self._lock:
                    self._target_cache[cache_key] = cached
        return cached.model_copy(
            update={
                "label": label,
                "above_display_headroom": (
                    resolved_target > display_headroom + 0.05 if display_headroom is not None else None
                ),
            }
        )

    @staticmethod
    def _reconstruction_label(artifact: ProofArtifact) -> str:
        if artifact.format == "avif_gain_map":
            return "Encoded AVIF gain map tone-mapped by libavif"
        if artifact.format == "jpegxl_hdr":
            return "Direct JPEG XL HDR adapted from authored SDR/HDR reference endpoints"
        return "Encoded JPEG endpoints reconstructed with ISO/Skia weighting"

    def _jpeg_target_tile(self, artifact: ProofArtifact, target: float) -> tuple[bytes, float, float]:
        from PIL import Image

        decoded_path = artifact.jpeg_decoded
        assert decoded_path is not None
        metadata = artifact.jpeg_gain_map
        offset_sdr = np.float32(metadata.offset_sdr if metadata else 1.0 / 64.0)
        offset_hdr = np.float32(metadata.offset_hdr if metadata else 1.0 / 64.0)
        peak_nits = 0.0
        clipped_pixels = 0
        ceiling = float(artifact.reference_white_nits) * (2.0 ** max(target, 0.0))

        def bands():
            nonlocal peak_nits, clipped_pixels
            with Image.open(artifact.path) as primary, decoded_path.open("rb") as raw:
                if artifact.jpeg_gain_range is None:
                    # Normalization uses whole-image channel extrema even
                    # though reconstruction and conversion run strip by strip.
                    artifact.jpeg_gain_range = _endpoint_gain_range(
                        _endpoint_log_gain(base, alternate, offset_sdr, offset_hdr)
                        for base, alternate in _jpeg_endpoint_bands(primary, raw, artifact)
                    )
                parameters = _endpoint_gain_parameters(
                    max(artifact.encoded_headroom, 0.01), metadata.hdr_capacity_min if metadata else 1.0,
                    offset_sdr, offset_hdr, *artifact.jpeg_gain_range)
                for base, alternate in _jpeg_endpoint_bands(primary, raw, artifact):
                    log_gain = _endpoint_log_gain(base, alternate, offset_sdr, offset_hdr)
                    pixels = _apply_endpoint_gain(base, log_gain, parameters, target)
                    nits = _image_luma_nits(pixels, artifact.reference_white_nits)
                    peak_nits = float(np.maximum(peak_nits, np.max(nits, initial=0.0)))
                    clipped_pixels += np.count_nonzero(nits > ceiling)
                    yield pixels

        try:
            with TemporaryDirectory(prefix="hdr_finisher_proof_tile_", ignore_cleanup_errors=True) as directory:
                y4m = Path(directory) / "preview_hdr.y4m"
                with closing(bands()) as pixels:
                    _write_hdr_y4m_bands(y4m, artifact.height, artifact.width, pixels, artifact.reference_white_nits)
                tile = _encode_hdr_avif_y4m(y4m, y4m.with_suffix(".avif"), PROOF_TILE_QUALITY)
        except (OSError, ValueError) as error:
            raise RuntimeError("Could not reconstruct the full-size JPEG Proof.") from error
        return tile, peak_nits, clipped_pixels / (artifact.height * artifact.width) * 100.0

    def _authored_target_tile(self, artifact: ProofArtifact, target: float) -> tuple[bytes, float, float]:
        base, alternate = self._matrix_endpoints(artifact)
        height, width = base.shape[:2]
        offset = np.float32(1.0 / 64.0)
        if artifact.authored_gain_range is None:
            with closing(_authored_log_gain_bands(base, alternate, offset, offset)) as gain_bands:
                artifact.authored_gain_range = _endpoint_gain_range(log_gain for _, log_gain in gain_bands)
        parameters = _endpoint_gain_parameters(
            max(artifact.encoded_headroom, 0.01), 1.0, offset, offset, *artifact.authored_gain_range
        )
        peak_nits = 0.0
        clipped_pixels = 0
        ceiling = float(artifact.reference_white_nits) * (2.0 ** max(target, 0.0))

        def bands():
            nonlocal peak_nits, clipped_pixels
            with closing(_authored_log_gain_bands(base, alternate, offset, offset)) as gain_bands:
                for base_rgb, log_gain in gain_bands:
                    pixels = _apply_endpoint_gain(base_rgb, log_gain, parameters, target)
                    nits = _image_luma_nits(pixels, artifact.reference_white_nits)
                    peak_nits = float(np.maximum(peak_nits, np.max(nits, initial=0.0)))
                    clipped_pixels += np.count_nonzero(nits > ceiling)
                    yield pixels

        utility = resolve_binary("avifgainmaputil") if artifact.format == "avif_gain_map" else None
        if utility is not None:
            # libavif makes the tile from the encoded artifact. The authored
            # reconstruction is only used for the displayed statistics.
            with closing(bands()) as pixels:
                for _ in pixels:
                    pass
            tile = self._tonemap_avif_tile(artifact, target, utility)
        else:
            try:
                with TemporaryDirectory(prefix="hdr_finisher_preview_", ignore_cleanup_errors=True) as directory:
                    y4m = Path(directory) / "preview_hdr.y4m"
                    with closing(bands()) as pixels:
                        _write_hdr_y4m_bands(y4m, height, width, pixels, artifact.reference_white_nits)
                    tile = _encode_hdr_avif_y4m(y4m, y4m.with_suffix(".avif"), PROOF_TILE_QUALITY)
            except OSError as error:
                raise RuntimeError("Failed to encode HDR AVIF preview.") from error
        return tile, peak_nits, clipped_pixels / max(height * width, 1) * 100.0

    def _decode_jpeg_endpoint(self, path: Path, artifact_id: str, width: int, height: int) -> Path:
        ultrahdr = resolve_binary("ultrahdr_app")
        if ultrahdr is None:
            raise RuntimeError("libultrahdr is unavailable for JPEG Proof reconstruction.")
        decoded_path = self.root / f"decoded-{artifact_id}.rgba-f16.raw"
        expected_bytes = height * width * 4 * np.dtype("<f2").itemsize
        if decoded_path.exists() and decoded_path.stat().st_size == expected_bytes:
            return decoded_path
        staged = self.root / f".decoded-{artifact_id}-{uuid4().hex}.rgba-f16.raw"
        try:
            _run_command([str(ultrahdr), "-m", "1", "-j", str(path), "-o", "0", "-O", "4", "-z", str(staged)])
            actual_bytes = staged.stat().st_size if staged.exists() else 0
            if actual_bytes != expected_bytes:
                raise RuntimeError(f"libultrahdr returned {actual_bytes} decoded bytes; expected {expected_bytes}.")
            staged.replace(decoded_path)
            return decoded_path
        finally:
            staged.unlink(missing_ok=True)

    def _matrix_endpoints(self, artifact: ProofArtifact) -> tuple[np.ndarray | DeliveryFrame, np.ndarray | DeliveryFrame]:
        if artifact.format != "jpeg_ultrahdr":
            return artifact.sdr_authored, artifact.hdr_authored
        ultrahdr = resolve_binary("ultrahdr_app")
        if ultrahdr is None:
            return artifact.sdr_authored, artifact.hdr_authored
        with self._lock:
            cached = self._endpoint_cache.get(artifact.artifact_id)
            endpoint_lock = self._endpoint_locks.setdefault(artifact.artifact_id, Lock())
        if cached is not None:
            return cached

        with endpoint_lock:
            with self._lock:
                cached = self._endpoint_cache.get(artifact.artifact_id)
            if cached is not None:
                return cached
            try:
                from PIL import Image

                with Image.open(artifact.path) as image:
                    base = _jpeg_base_endpoint(image.convert("RGB"))
                decoded_path = self._decode_jpeg_endpoint(artifact.path, artifact.artifact_id,
                                                          artifact.width, artifact.height)
                decoded = np.fromfile(decoded_path, dtype="<f2").reshape(artifact.height, artifact.width, 4)
                use_base = artifact.jpeg_gain_map is None or artifact.jpeg_gain_map.use_base_color_space
                alternate = _jpeg_alternate_endpoint(decoded, artifact.reference_white_nits, use_base)
                endpoints = base, alternate
                with self._lock:
                    self._endpoint_cache[artifact.artifact_id] = endpoints
                return endpoints
            except (OSError, ValueError, RuntimeError):
                return artifact.sdr_authored, artifact.hdr_authored

    def _encoded_matrix_tile(self, artifact: ProofArtifact, target: float, reconstructed: np.ndarray) -> bytes:
        if artifact.format == "avif_gain_map":
            utility = resolve_binary("avifgainmaputil")
            if utility is not None:
                return self._tonemap_avif_tile(artifact, target, utility)
        # Only jpeg_ultrahdr reconstructs from genuinely decoded endpoints -- an
        # 8-bit sRGB base and an 8-bit gain map -- so it is the one format whose
        # tile is already carrying quantization before it is encoded. Matching
        # the quality libavif tonemaps at keeps the proof from adding shadow
        # artifacts of its own on top of that.
        return _encode_hdr_avif(reconstructed, artifact.reference_white_nits, quality=PROOF_TILE_QUALITY)

    def _tonemap_avif_tile(self, artifact: ProofArtifact, target: float, utility: Path) -> bytes:
        target_key = str(target).replace(".", "_")
        output = self.root / f"tonemap-{artifact.artifact_id}-{target_key}.avif"
        if not output.exists():
            encoder = resolve_binary("avifenc") if artifact.full_size else None
            with TemporaryDirectory(prefix="tonemap-", dir=self.root) as directory:
                staged = Path(directory) / "tile.avif"
                y4m = staged.with_suffix(".y4m")
                _run_command([
                    str(utility), "tonemap", str(artifact.path), str(y4m if encoder else staged),
                    "--headroom", f"{target:.6f}", "--cicp-output", "9/16/9",
                    "-d", "10", "-y", "444", "-q", "90",
                ])
                if encoder:
                    # The tonemap utility uses the library's manual tile defaults.
                    # avifenc would otherwise choose different tiles on large photos.
                    _run_command([
                        str(encoder), "--cicp", "9/16/9", "-d", "10", "-y", "444",
                        "-s", "6", "-q", "90", "-j", "1", "--tilerowslog2", "0", "--tilecolslog2", "0",
                        str(y4m), str(staged),
                    ])
                payload = staged.read_bytes()
                try:
                    staged.replace(output)
                except PermissionError:
                    if not output.exists():
                        raise
                return payload
        return output.read_bytes()

    @staticmethod
    def _request_signature(
        session_id: str,
        request: ProofArtifactRequest,
        color_context: RenderColorContext,
        denoise: object | None = None,
        source_epoch: int = 0,
        framing: object | None = None,
        local_adjustments: list | None = None,
    ) -> str:
        # The revision validates the request on arrival. The resolved settings
        # and source epoch below identify the pixels that Proof will render.
        excluded = {"force", "editing_measurements"}
        if request.adjustments is not None:
            excluded.add("edit_revision")
        request_payload = request.model_dump_json(exclude=excluded)
        if request.export_with_frame and framing is not None:
            request_payload += framing.model_dump_json()
        denoise_payload = denoise_delivery_key(SimpleNamespace(denoise=denoise))
        # Local adjustments live on the session, not in the request, so they are
        # folded in like Denoise: a proof made before a Local edit must not be
        # served for it when the request carries no edit revision.
        locals_payload = json.dumps([
            local.model_dump(mode="json") if hasattr(local, "model_dump") else local
            for local in (local_adjustments or [])
        ], sort_keys=True, default=str)
        from .delivery import renderer_record, preferences
        try: policy = preferences()["effective_force_cpu"]
        except (OSError, ValueError, AttributeError): policy = renderer_record()["fallback_reason"]
        payload = (
            f"{APP_VERSION}|{session_id}|{color_context.cache_key}|{denoise_payload}|{request_payload}|{policy}|{source_epoch}"
            f"|{locals_payload}"
        ).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()[:24]

    @staticmethod
    def _response(artifact: ProofArtifact, estimates: dict | None = None) -> ProofArtifactResponse:
        from .peak_accuracy import measurement_warnings
        suffix, _media_type = PROOF_FORMAT_INFO[artifact.format]
        return ProofArtifactResponse(
            artifact_id=artifact.artifact_id,
            renderer=artifact.renderer, fallback_reason=artifact.fallback_reason,
            delivery_notes=list(artifact.delivery_notes),
            format=artifact.format,
            media_type=artifact.media_type,
            byte_size=artifact.path.stat().st_size,
            sha256=artifact.sha256,
            url=f"/api/proof/artifact/{artifact.artifact_id}{suffix}",
            wrong_mime_url=f"/api/proof/artifact/{artifact.artifact_id}{suffix}?mime=wrong",
            width=artifact.width,
            height=artifact.height,
            full_size=artifact.full_size,
            quality=artifact.quality,
            metadata_summary=artifact.metadata_summary,
            encoded_headroom=round(artifact.encoded_headroom, 4),
            jpeg_gain_map=artifact.jpeg_gain_map,
            measurement_warnings=measurement_warnings(estimates or {}, artifact.exact_measurements or {}) if artifact.full_size else [],
        )


def _select_proof_display(displays: list[dict[str, Any]], display_id: str | None) -> dict[str, Any] | None:
    if display_id:
        selected = next((display for display in displays if str(display.get("id")) == display_id), None)
        if selected is not None:
            return selected
    return next((display for display in displays if bool(display.get("primary"))), None) or (displays[0] if displays else None)


def target_headroom_for_peak_nits(peak_nits: float, reference_white_nits: int = 203) -> float:
    return max(0.0, math.log2(float(peak_nits) / float(reference_white_nits)))


def _optional_float(value: object) -> float | None:
    try:
        parsed = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _inspect_artifact(path: Path, format_name: str, reference_white_nits: int = 203) -> tuple[float, str]:
    if format_name == "avif_gain_map":
        info = inspect_avif(path, jobs=1)
        gain = info.get("gain_map") or {}
        headroom = float(gain.get("alternate_headroom", 0.0))
        return headroom, "ISO 21496-1 AVIF gain map; SDR base; 10-bit gain map"

    if format_name == "jpegxl_hdr":
        info = inspect_jpegxl(path)
        metadata = info.get("app_metadata") or {}
        if metadata.get("color_space") != "BT.2020" or metadata.get("transfer_function") != "PQ":
            raise ValueError("JPEG XL proof is missing its direct-HDR Rec.2020 PQ marker.")
        bit_depth = int(metadata.get("bit_depth") or info.get("bits_per_sample") or 12)
        sample_type = str(metadata.get("sample_type") or "integer")
        return target_headroom_for_peak_nits(10000.0, reference_white_nits), f"Direct HDR JPEG XL; Rec.2020 PQ; {bit_depth}-bit {sample_type}"

    metadata = _inspect_jpeg_gain_map(path)
    headroom = math.log2(max(1.0, metadata.hdr_capacity_max))
    return headroom, "Ultra HDR v1 XMP + ISO 21496-1; SDR JPEG base; 8-bit gain map"


def _inspect_jpeg_gain_map(path: Path) -> JPEGGainMapProofMetadata:
    ultrahdr = resolve_binary("ultrahdr_app")
    if ultrahdr is None:
        raise RuntimeError("Ultra HDR metadata probe is unavailable.")
    result = _run_command([str(ultrahdr), "-m", "1", "-j", str(path), "-P"])
    probe = f"{result.stdout}\n{result.stderr}"
    # Input loading and proofing share parsing while retaining an injectable runner.
    return parse_jpeg_gain_map_probe(probe, strict=False)


def _default_jpeg_gain_map_metadata(encoded_headroom: float) -> JPEGGainMapProofMetadata:
    return JPEGGainMapProofMetadata(
        use_base_color_space=True,
        base_gamut="sRGB / BT.709",
        alternate_gamut="BT.2020",
        reconstruction_gamut="sRGB / BT.709",
        min_content_boost=1.0,
        max_content_boost=float(2.0 ** max(encoded_headroom, 0.0)),
        gamma=1.0,
        hdr_capacity_min=1.0,
        hdr_capacity_max=float(2.0 ** max(encoded_headroom, 0.0)),
        offset_sdr=1.0 / 64.0,
        offset_hdr=1.0 / 64.0,
    )


def _image_luma_nits(image: np.ndarray, reference_white_nits: int) -> np.ndarray:
    bt2020 = np.clip(acescg_to_linear_bt2020(image[..., :3]), 0.0, None)
    luma = 0.2627 * bt2020[..., 0] + 0.6780 * bt2020[..., 1] + 0.0593 * bt2020[..., 2]
    return scene_linear_to_nits(luma, reference_white_nits)


def _image_stats(image: np.ndarray, target_headroom: float, reference_white_nits: int = 203) -> tuple[float, float]:
    nits = _image_luma_nits(image, reference_white_nits)
    peak = float(np.max(nits, initial=0.0))
    ceiling = float(reference_white_nits) * (2.0 ** max(target_headroom, 0.0))
    clipped = float(np.count_nonzero(nits > ceiling) / max(nits.size, 1) * 100.0)
    return peak, clipped
