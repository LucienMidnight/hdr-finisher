from __future__ import annotations

import atexit
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
from tempfile import mkdtemp
from threading import RLock
from types import SimpleNamespace
from typing import Any

import numpy as np

from .adjustments import apply_adjustments
from .avif_info import inspect_avif
from .binaries import resolve_binary
from .color import acescg_to_linear_bt2020, linear_bt2020_to_acescg, linear_srgb_to_acescg
from .config import APP_DATA_DIR, APP_VERSION
from .exporters import ExportBackend, _run_command
from .models import (
    BrowserEvidenceRecord,
    BrowserEvidenceResponse,
    ExportSettings,
    JPEGGainMapProofMetadata,
    PreviewKind,
    ProofArtifactRequest,
    ProofArtifactResponse,
    ProofMatrixResponse,
    ProofMatrixTile,
    ProofReconstructionRequest,
    ProofReconstructionResponse,
)
from .preview import _encode_hdr_avif


SUPPORTED_PROOF_FORMATS = {"jpeg_ultrahdr", "avif_gain_map"}
MATRIX_HEADROOMS = (0.0, 1.0, 2.0, 3.0, 4.0)


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
    hdr_authored: np.ndarray
    sdr_authored: np.ndarray
    jpeg_gain_map: JPEGGainMapProofMetadata | None = None


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
    epsilon_sdr = np.full((3,), offset_sdr, dtype=np.float32)
    epsilon_hdr = np.full((3,), offset_hdr, dtype=np.float32)
    base_rgb = np.clip(base[..., :3].astype(np.float32, copy=False), 0.0, None)
    alternate_rgb = np.clip(alternate[..., :3].astype(np.float32, copy=False), 0.0, None)
    log_gain = np.log(alternate_rgb + epsilon_hdr) - np.log(base_rgb + epsilon_sdr)
    gain_min = np.min(log_gain, axis=(0, 1)).astype(np.float32)
    gain_max = np.max(log_gain, axis=(0, 1)).astype(np.float32)
    span = np.maximum(gain_max - gain_min, np.float32(1e-6))
    normalized = np.clip((log_gain - gain_min) / span, 0.0, 1.0)
    parameters = GainMapParameters(
        display_ratio_sdr=max(float(display_ratio_sdr), 1e-8),
        display_ratio_hdr=float(2.0 ** max(encoded_headroom, 0.0)),
        gain_min=gain_min,
        gain_max=gain_max,
        gamma=np.ones((3,), dtype=np.float32),
        epsilon_sdr=epsilon_sdr,
        epsilon_hdr=epsilon_hdr,
    )
    return apply_gain_map_formula(base_rgb, normalized, parameters, target)


class ProofArtifactStore:
    def __init__(self) -> None:
        self.root = Path(mkdtemp(prefix="hdr_finisher_proof_"))
        self._lock = RLock()
        self._artifacts: dict[str, ProofArtifact] = {}
        self._tiles: dict[str, ProofTile] = {}
        self._request_cache: dict[str, str] = {}
        self._target_cache: dict[str, ProofMatrixTile] = {}
        atexit.register(self.clear)

    def clear(self) -> None:
        with self._lock:
            self._artifacts.clear()
            self._tiles.clear()
            self._request_cache.clear()
            self._target_cache.clear()
        shutil.rmtree(self.root, ignore_errors=True)

    def create(
        self,
        session: object,
        request: ProofArtifactRequest,
        backend: ExportBackend,
    ) -> ProofArtifactResponse:
        if request.format not in SUPPORTED_PROOF_FORMATS:
            raise ValueError(f"Unsupported proof format: {request.format}")
        signature = self._request_signature(getattr(session, "session_id"), request)
        with self._lock:
            cached_id = self._request_cache.get(signature)
            cached = self._artifacts.get(cached_id or "")
            if cached is not None and cached.path.exists():
                return self._response(cached)

        source, sdr_reference = getattr(session, "render_cache").source_pair(request.long_edge)
        proxy_session = SimpleNamespace(
            session_id=f"proof-{getattr(session, 'session_id', 'session')}",
            image=source,
            sdr_reference_image=sdr_reference,
            adjustments=request.adjustments,
        )
        suffix = ".jpg" if request.format == "jpeg_ultrahdr" else ".avif"
        staged = self.root / f"request-{signature}{suffix}"
        result = backend.export(
            proxy_session,
            ExportSettings(
                format=request.format,
                quality=request.quality,
                jpeg_gain_map_quality=request.jpeg_gain_map_quality,
                jpeg_gain_map_scale=request.jpeg_gain_map_scale,
                output_path=str(staged),
            ),
        )
        if not result.accepted or not result.output_path:
            raise RuntimeError(result.message)
        output_path = Path(result.output_path)
        payload = output_path.read_bytes()
        digest = hashlib.sha256(payload).hexdigest()
        artifact_id = digest[:24]
        final_path = self.root / f"{artifact_id}{suffix}"
        if output_path != final_path:
            if final_path.exists():
                output_path.unlink(missing_ok=True)
            else:
                output_path.replace(final_path)

        hdr_authored = apply_adjustments(source, request.adjustments, PreviewKind.HDR)
        sdr_authored = apply_adjustments(
            source,
            request.adjustments,
            PreviewKind.SDR,
            sdr_reference_image=sdr_reference,
        )
        # The SDR branch is display-linear sRGB where 1.0 is reference white.
        # Matrix rendering uses the HDR working convention where 0.18 is
        # 100-nit diffuse white, so normalize the endpoint before applying a
        # gain map or encoding a PQ tile.
        encoded_sdr_linear = np.clip(sdr_authored[..., :3], 0.0, 1.0)
        sdr_matrix_endpoint = np.clip(
            linear_srgb_to_acescg(encoded_sdr_linear) * np.float32(0.18),
            0.0,
            None,
        )
        encoded_headroom, metadata_summary = _inspect_artifact(final_path, request.format)
        jpeg_gain_map = None
        if request.format == "jpeg_ultrahdr":
            try:
                jpeg_gain_map = _inspect_jpeg_gain_map(final_path)
            except (OSError, ValueError, RuntimeError):
                jpeg_gain_map = _default_jpeg_gain_map_metadata(encoded_headroom)
        height, width = hdr_authored.shape[:2]
        artifact = ProofArtifact(
            artifact_id=artifact_id,
            format=request.format,
            path=final_path,
            media_type="image/jpeg" if request.format == "jpeg_ultrahdr" else "image/avif",
            sha256=digest,
            width=int(width),
            height=int(height),
            quality=request.quality,
            metadata_summary=metadata_summary,
            encoded_headroom=encoded_headroom,
            hdr_authored=np.ascontiguousarray(hdr_authored, dtype=np.float32),
            sdr_authored=np.ascontiguousarray(sdr_matrix_endpoint, dtype=np.float32),
            jpeg_gain_map=jpeg_gain_map,
        )
        with self._lock:
            self._artifacts[artifact_id] = artifact
            self._request_cache[signature] = artifact_id
        return self._response(artifact)

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
            requested_headroom = target_headroom_for_peak_nits(requested_peak_nits)
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
            resolved_reference_peak_nits=round(100.0 * (2.0 ** resolved_headroom), 1),
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
        with self._lock:
            cached = self._target_cache.get(cache_key)
        if cached is None:
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
            tile_hash = hashlib.sha256(tile_bytes).hexdigest()
            tile_id = tile_hash[:24]
            tile_path = self.root / f"tile-{tile_id}.avif"
            if not tile_path.exists():
                tile_path.write_bytes(tile_bytes)
            with self._lock:
                self._tiles[tile_id] = ProofTile(tile_id=tile_id, path=tile_path, media_type="image/avif")
            peak_nits, clipped = _image_stats(reconstructed, resolved_target)
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
        return (
            "Encoded AVIF gain map tone-mapped by libavif"
            if artifact.format == "avif_gain_map"
            else "Encoded JPEG endpoints reconstructed with ISO/Skia weighting"
        )

    def _matrix_endpoints(self, artifact: ProofArtifact) -> tuple[np.ndarray, np.ndarray]:
        if artifact.format != "jpeg_ultrahdr":
            return artifact.sdr_authored, artifact.hdr_authored
        ultrahdr = resolve_binary("ultrahdr_app")
        if ultrahdr is None:
            return artifact.sdr_authored, artifact.hdr_authored
        try:
            from PIL import Image

            with Image.open(artifact.path) as image:
                srgb = np.asarray(image.convert("RGB"), dtype=np.float32) / np.float32(255.0)
            linear_srgb = np.where(
                srgb <= 0.04045,
                srgb / 12.92,
                np.power((srgb + 0.055) / 1.055, 2.4),
            )
            base = linear_srgb_to_acescg(linear_srgb) * np.float32(0.18)
            decoded_path = self.root / f"decoded-{artifact.artifact_id}.rgba-f16.raw"
            if not decoded_path.exists():
                _run_command(
                    [
                        str(ultrahdr),
                        "-m",
                        "1",
                        "-j",
                        str(artifact.path),
                        "-o",
                        "0",
                        "-O",
                        "4",
                        "-z",
                        str(decoded_path),
                    ]
                )
            decoded = np.fromfile(decoded_path, dtype="<f2").astype(np.float32)
            decoded = decoded.reshape(artifact.height, artifact.width, 4)[..., :3]
            # libultrahdr linear output uses 1.0 == 203 nits. HDR Finisher uses
            # 0.18 == 100 nits, so convert back to the app's scene-linear scale.
            decoded *= np.float32(203.0 * 0.18 / 100.0)
            if artifact.jpeg_gain_map is None or artifact.jpeg_gain_map.use_base_color_space:
                alternate = linear_srgb_to_acescg(decoded)
            else:
                alternate = linear_bt2020_to_acescg(decoded)
            return np.clip(base, 0.0, None), np.clip(alternate, 0.0, None)
        except (OSError, ValueError, RuntimeError):
            return artifact.sdr_authored, artifact.hdr_authored

    def _encoded_matrix_tile(self, artifact: ProofArtifact, target: float, reconstructed: np.ndarray) -> bytes:
        if artifact.format == "avif_gain_map":
            utility = resolve_binary("avifgainmaputil")
            if utility is not None:
                target_key = str(target).replace(".", "_")
                output = self.root / f"tonemap-{artifact.artifact_id}-{target_key}.avif"
                if not output.exists():
                    _run_command(
                        [
                            str(utility),
                            "tonemap",
                            str(artifact.path),
                            str(output),
                            "--headroom",
                            f"{target:.6f}",
                            "--cicp-output",
                            "9/16/9",
                            "-d",
                            "10",
                            "-y",
                            "444",
                            "-q",
                            "90",
                        ]
                    )
                return output.read_bytes()
        return _encode_hdr_avif(reconstructed)

    @staticmethod
    def _request_signature(session_id: str, request: ProofArtifactRequest) -> str:
        payload = f"{APP_VERSION}|{session_id}|{request.model_dump_json()}".encode("utf-8")
        return hashlib.sha256(payload).hexdigest()[:24]

    @staticmethod
    def _response(artifact: ProofArtifact) -> ProofArtifactResponse:
        suffix = ".jpg" if artifact.format == "jpeg_ultrahdr" else ".avif"
        return ProofArtifactResponse(
            artifact_id=artifact.artifact_id,
            format=artifact.format,
            media_type=artifact.media_type,
            byte_size=artifact.path.stat().st_size,
            sha256=artifact.sha256,
            url=f"/api/proof/artifact/{artifact.artifact_id}{suffix}",
            wrong_mime_url=f"/api/proof/artifact/{artifact.artifact_id}{suffix}?mime=wrong",
            width=artifact.width,
            height=artifact.height,
            quality=artifact.quality,
            metadata_summary=artifact.metadata_summary,
            encoded_headroom=round(artifact.encoded_headroom, 4),
            jpeg_gain_map=artifact.jpeg_gain_map,
        )


def _select_proof_display(displays: list[dict[str, Any]], display_id: str | None) -> dict[str, Any] | None:
    if display_id:
        selected = next((display for display in displays if str(display.get("id")) == display_id), None)
        if selected is not None:
            return selected
    return next((display for display in displays if bool(display.get("primary"))), None) or (displays[0] if displays else None)


def target_headroom_for_peak_nits(peak_nits: float) -> float:
    return max(0.0, math.log2(float(peak_nits) / 100.0))


def _optional_float(value: object) -> float | None:
    try:
        parsed = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


class EvidenceStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or (APP_DATA_DIR / "delivery-proof-evidence.json")
        self._lock = RLock()

    def list(self) -> BrowserEvidenceResponse:
        with self._lock:
            records = self._read()
        return BrowserEvidenceResponse(records=records)

    def add(self, record: BrowserEvidenceRecord) -> BrowserEvidenceResponse:
        normalized = record.model_copy(update={"observed_at": datetime.now(timezone.utc)})
        with self._lock:
            records = self._read()
            records.append(normalized)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(".tmp")
            temporary.write_text(
                json.dumps([item.model_dump(mode="json") for item in records], indent=2),
                encoding="utf-8",
            )
            temporary.replace(self.path)
        return BrowserEvidenceResponse(records=records)

    def _read(self) -> list[BrowserEvidenceRecord]:
        if not self.path.exists():
            return []
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            return [BrowserEvidenceRecord.model_validate(item) for item in payload]
        except (OSError, ValueError, TypeError):
            return []


def _inspect_artifact(path: Path, format_name: str) -> tuple[float, str]:
    if format_name == "avif_gain_map":
        info = inspect_avif(path)
        gain = info.get("gain_map") or {}
        headroom = float(gain.get("alternate_headroom", 0.0))
        return headroom, "ISO 21496-1 AVIF gain map; SDR base; 10-bit gain map"

    metadata = _inspect_jpeg_gain_map(path)
    headroom = math.log2(max(1.0, metadata.hdr_capacity_max))
    return headroom, "Ultra HDR v1 XMP + ISO 21496-1; SDR JPEG base; 8-bit gain map"


def _inspect_jpeg_gain_map(path: Path) -> JPEGGainMapProofMetadata:
    ultrahdr = resolve_binary("ultrahdr_app")
    if ultrahdr is None:
        raise RuntimeError("Ultra HDR metadata probe is unavailable.")
    result = _run_command([str(ultrahdr), "-m", "1", "-j", str(path), "-P"])
    probe = f"{result.stdout}\n{result.stderr}"

    def scalar(name: str, default: float) -> float:
        match = re.search(
            rf"{re.escape(name)}\s+([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)",
            probe,
            flags=re.IGNORECASE,
        )
        return float(match.group(1)) if match else default

    use_base = bool(round(scalar("--useBaseColorSpace", 1.0)))
    return JPEGGainMapProofMetadata(
        use_base_color_space=use_base,
        base_gamut="sRGB / BT.709",
        alternate_gamut="BT.2020",
        reconstruction_gamut="sRGB / BT.709" if use_base else "BT.2020",
        min_content_boost=max(scalar("--minContentBoost", 1.0), 1e-8),
        max_content_boost=max(scalar("--maxContentBoost", 1.0), 1e-8),
        gamma=max(scalar("--gamma", 1.0), 1e-8),
        hdr_capacity_min=max(scalar("--hdrCapacityMin", 1.0), 1e-8),
        hdr_capacity_max=max(scalar("--hdrCapacityMax", 1.0), 1.0),
        offset_sdr=max(scalar("--offsetSdr", 1.0 / 64.0), 0.0),
        offset_hdr=max(scalar("--offsetHdr", 1.0 / 64.0), 0.0),
    )


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


def _image_stats(image: np.ndarray, target_headroom: float) -> tuple[float, float]:
    bt2020 = np.clip(acescg_to_linear_bt2020(image[..., :3]), 0.0, None)
    luma = 0.2627 * bt2020[..., 0] + 0.6780 * bt2020[..., 1] + 0.0593 * bt2020[..., 2]
    nits = luma * np.float32(100.0 / 0.18)
    peak = float(np.max(nits, initial=0.0))
    ceiling = 100.0 * (2.0 ** max(target_headroom, 0.0))
    clipped = float(np.count_nonzero(nits > ceiling) / max(nits.size, 1) * 100.0)
    return peak, clipped
