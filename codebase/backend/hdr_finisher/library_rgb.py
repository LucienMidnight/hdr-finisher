"""Library-only decoded RGB boundary. Grade/export/Proof keep their loader."""
from pathlib import Path
from time import perf_counter

import numpy as np
from PIL import Image

from . import loader
from .color import _LINEAR_SRGB_TO_ACESCG, _ACESCG_TO_LINEAR_SRGB, _ACESCG_TO_LINEAR_BT2020
from .library_gpu_raw import NotEligible, _identity
from .models import SourceInterpretationOverride, SourceImageDescriptor, SourceReference, EditDocument, HDRAnalysis
from .import_defaults import starting_adjustments
from .source_luminance import describe_source_luminance

VERSION = "library-rgb-v1"


def decoded(path, inputs):
    path = Path(path).resolve(strict=True)
    if path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
        raise NotEligible("RGB preparation currently supports ordinary JPEG/PNG only")
    if SourceInterpretationOverride.model_validate(inputs["interpretation_override"]) != SourceInterpretationOverride():
        raise NotEligible("RGB interpretation overrides retain Grade's CPU loader")
    if path.suffix.lower() != ".png" and loader.is_ultrahdr_jpeg(path):
        raise NotEligible("gain-map JPEG retains its existing decoder")
    identity = _identity(path)
    start = perf_counter()
    with Image.open(path) as image:
        orientation = int(image.getexif().get(274, 1))
        original_mode = image.mode
        icc = image.info.get("icc_profile")
    # This is the very same CPU orientation/ICC boundary used by Grade.
    pixels, metadata = loader._load_with_pillow(path, encoded_samples=True)
    if metadata.get("needs_color_override") or metadata.get("color_space") != "sRGB":
        raise NotEligible("ICC interpretation is unresolved or not representable as sRGB")
    if _identity(path) != identity:
        raise ValueError("Photo changed during RGB decode.")
    height, width = pixels.shape[:2]
    return {
        "rgb": True, "adapter_version": VERSION, "path": str(path), "identity": identity,
        "width": width, "height": height, "flip": 0,
        "mosaic_bytes": pixels.nbytes, "sample_stride": max(1, int(np.ceil(np.sqrt(width * height / 2_000_000)))),
        "layout": {"order": "HWC", "channels": ["R", "G", "B"], "row_stride": pixels.strides[0],
                   "dtype": str(pixels.dtype), "effective_bits": 8, "code_range": [0, 255],
                   "alpha": "discarded by Grade decoder", "ownership": "request-owned", "original_mode": original_mode,
                   "data_window": [0, 0, width, height], "display_window": [0, 0, width, height], "origin": [0, 0]},
        "orientation": {"original": orientation, "applied": True},
        "colour": {"primaries": "sRGB", "transfer": "sRGB", "icc_present": bool(icc),
                   "icc_applied_cpu": bool(metadata.get("icc_converted_to_srgb")),
                   "original_profile": metadata.get("source_icc_profile_name"), "decoder_normalized": False,
                   "eotf_applied": False, "reference_white_nits": inputs["hdr_reference_white_nits"],
                   "linear_reference": "scene_0_18", "authored_sdr": True},
        "rgb_to_acescg": _LINEAR_SRGB_TO_ACESCG.T.tolist(),
        "acescg_to_srgb": _ACESCG_TO_LINEAR_SRGB.T.tolist(),
        "acescg_to_bt2020": _ACESCG_TO_LINEAR_BT2020.T.tolist(),
        "decode_ms": (perf_counter() - start) * 1000,
        "decoder_version": loader.SOURCE_DECODER_VERSION,
        "colour_version": loader.SOURCE_COLOR_TRANSFORM_VERSION,
    }, [memoryview(np.ascontiguousarray(pixels)).cast("B")]


def developed(cache, path, header, payload):
    from .sessions import _sha256_file
    path = Path(path).resolve(strict=True)
    if _identity(path) != header["identity"]:
        raise ValueError("Photo changed during RGB preparation.")
    h, w = int(header["height"]), int(header["width"])
    if len(payload) != h * w * 24:
        raise ValueError("Incomplete RGB scene/rendition payload.")
    planes = np.frombuffer(payload, dtype="<f4").reshape(6, h, w)
    if not np.all(np.isfinite(planes)):
        raise ValueError("RGB GPU preparation produced invalid samples.")
    pixels = np.ascontiguousarray(planes[:3].transpose(1, 2, 0))
    reference = np.ascontiguousarray(planes[3:].transpose(1, 2, 0))
    peak, robust = header["peaks"], header["robust"]
    # SDR JPEG/PNG cannot gain HDR headroom through a colour matrix.
    analysis = HDRAnalysis(classification="SDR_ONLY", badge_message="Authored SDR file rendition.",
        peak_stops_above_diffuse_white=max(0.0,float(np.log2(max(peak["peak"],1e-20)/.18))), peak_linear=peak["peak"], robust_peak_linear=robust["channel"],
        peak_luma_linear=peak["peak_luma"], robust_peak_luma_linear=robust["luma"],
        peak_bt2020_linear=peak["peak_bt2020"], robust_peak_bt2020_linear=robust["bt2020"])
    white = header["colour"]["reference_white_nits"]
    # A one-value reference supplies the exact full-source SDR peak to defaults.
    look = starting_adjustments(analysis, np.array([peak["sdr"]], dtype=np.float32), white)
    source = SourceImageDescriptor(filename=path.name, suffix=path.suffix.lower(),
        width=header["source_width"], height=header["source_height"], channels=3, dtype="float32",
        source_color_space="sRGB", transfer_function="sRGB")
    fingerprint = _sha256_file(path)
    document = EditDocument(hdr_reference_white_nits=white, global_adjustments=look,
        source=SourceReference(filename=path.name, durable_path=str(path), byte_size=path.stat().st_size,
            fingerprint_sha256=fingerprint,
            luminance=describe_source_luminance(source, {"sdr_file_rendition": True}, has_authored_sdr=True)))
    if _identity(path) != header["identity"]:
        raise ValueError("Photo changed during RGB preparation.")
    metadata = {"route": "library-live", "renderer": "gpu", "rgb_adapter": VERSION,
        "starting_look": look.model_dump(mode="json"), "default_document": document.model_dump(mode="json"),
        "source_width": source.width, "source_height": source.height,
        "source_fingerprint_sha256": fingerprint, "gpu_memory_peak_bytes": header["memory_peak_bytes"],
        "source_analysis": analysis.model_dump(mode="json"), "rgb_contract": {"colour": header["colour"], "layout": header.get("layout"), "orientation": header.get("orientation")},
        "source_timings_ms": header.get("timing_ms")}
    return cache.build(path, header["edge"], header["source_quality"], decoded=(pixels, reference, metadata))
