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

VERSION = "library-rgb-v3"


def decoded(path, inputs):
    path = Path(path).resolve(strict=True)
    if path.suffix.lower() in {".exr", ".hdr", ".pfm", ".tif", ".tiff", ".jxl", ".avif", ".heic", ".heif"}:
        return decoded_precision(path, inputs)
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


def decoded_precision(path, inputs):
    """Use decoder-owned float32 samples, before transfer/gamut preparation."""
    from . import color
    identity = _identity(path)
    start = perf_counter()
    suffix = path.suffix.lower()
    facts = {}
    reference = None
    if suffix == ".jxl":
        pixels, metadata = loader.decode_jpegxl(path, encoded_samples=True)
        facts.update(orientation=None, effective_bits=int(metadata["bit_depth"]), sample_type=metadata["sample_type"], jpegxl_info=metadata["jpegxl_info"])
    elif suffix == ".avif":
        try:
            pixels, reference, metadata = loader.decode_avif(path, encoded_samples=True)
        except loader.GainMapDecodeError as error:
            raise NotEligible(str(error)) from error
        facts.update(effective_bits=int(metadata["bit_depth"]), intermediate_bits=16, orientation=metadata["orientation"])
    elif suffix in {".heic", ".heif"}:
        try:
            pixels, metadata = loader._load_heif(path, primary_samples_only=True)
        except loader.LoaderError as error:
            raise NotEligible(str(error)) from error
        facts.update(orientation=None, effective_bits=int(metadata["bit_depth"]), primary_index=metadata["heif_primary_index"])
    elif suffix == ".exr":
        pixels, metadata = loader._load_exr(path, combined_channels=True)
        import OpenEXR
        file = OpenEXR.InputFile(str(path))
        try:
            exr = file.header()
            for name in ("dataWindow", "displayWindow"):
                box = exr[name]
                facts[name] = [box.min.x, box.min.y, box.max.x + 1, box.max.y + 1]
            facts["compression"] = str(exr.get("compression"))
            facts["white_luminance"] = exr.get("whiteLuminance")
            facts["channel_types"] = {name: str(exr["channels"][name].type) for name in metadata["selected_rgb_channels"]}
            facts["effective_bits"] = [16 if kind == "HALF" else 32 for kind in facts["channel_types"].values()]
        finally:
            file.close()
    elif suffix in {".tif", ".tiff"}:
        pixels, metadata = loader._load_tiff(path)
        import tifffile
        with tifffile.TiffFile(path) as tif:
            page = tif.pages[0]
            tag = page.tags.get("Orientation")
            facts["orientation"] = int(tag.value) if tag else 1
            facts["bits_per_sample"] = page.bitspersample
            facts["sample_format"] = str(page.sampleformat)
        # Grade currently leaves the TIFF orientation tag unapplied.
    else:
        try:
            pixels, metadata = loader._load_hdr_like(path)
        except Exception as error:
            raise NotEligible("HDR/PFM imageio decoder unavailable: " + str(error)) from error
    decode_ms = (perf_counter() - start) * 1000
    original_interpretation = {key:metadata.get(key) for key in ("color_space","transfer_function","needs_color_override")}
    override = {k: v for k, v in inputs["interpretation_override"].items() if v is not None}
    if reference is not None and override:
        raise NotEligible("Gain-map AVIF interpretation overrides retain the CPU loader")
    decoder_normalized = bool(metadata.get("decoder_normalized_to_acescg"))
    sample_space = metadata.get("sample_color_space")
    sample_transfer = metadata.get("sample_transfer_function")
    if decoder_normalized and override:
        # Grade applies overrides AFTER decoder normalization at 203 nits.
        # Keep this less common first transform CPU-owned, then use the shared GPU.
        pixels = color.normalize_to_acescg_bounded(pixels, sample_space, sample_transfer)
    for key in ("color_space", "transfer_function"):
        if override.get(key): metadata[key] = override[key]
    if override.get("color_space"): metadata["needs_color_override"] = False
    if override: metadata["user_override"] = override
    metadata["color_space"] = color.detect_color_space(metadata, suffix)
    metadata["transfer_function"] = metadata.get("transfer_function") or color.detect_transfer_function(metadata, suffix)
    if metadata.get("needs_color_override") or metadata["color_space"] is None:
        raise NotEligible("Unresolved source primaries retain Grade's interpretation gate")
    operation_space = sample_space if decoder_normalized and not override else metadata["color_space"]
    operation_transfer = sample_transfer if decoder_normalized and not override else metadata["transfer_function"]
    transfer = color._canonical_transfer_function(operation_transfer)
    space = color._canonical_colourspace(operation_space, transfer)
    if transfer is None:
        transfer = "sRGB" if space in {color.SRGB_COLOURSPACE, color.DISPLAY_P3_COLOURSPACE} else "LINEAR"
    if transfer not in {"LINEAR", "ACEScg", "sRGB", "BT.709", "PQ", "HLG"}:
        raise NotEligible("RGB transfer " + str(transfer) + " retains Grade's CPU normalization")
    if transfer in {"PQ", "HLG"} and suffix not in {".jxl", ".avif", ".heic", ".heif"}:
        raise NotEligible("PQ/HLG preparation is qualified only for Batch 3 codecs")
    if space == color.ACESCG_COLOURSPACE and transfer not in {"BT.709", "PQ", "HLG"}: transfer = "LINEAR"
    linear_reference = override.get("linear_reference") or "scene_0_18"
    if linear_reference == "diffuse_white_1_0" and str(metadata["transfer_function"]).upper() != "LINEAR":
        raise loader.LoaderError("The 1.0 diffuse-white reference is only valid for linear sources.")
    if pixels.ndim == 2: pixels = pixels[..., None]
    if pixels.ndim != 3 or pixels.shape[-1] == 2:
        raise NotEligible("Unsupported decoded RGB sample layout")
    if pixels.shape[-1] == 1: pixels = np.repeat(pixels, 3, axis=2)
    pixels = np.ascontiguousarray(pixels[..., :3], dtype="<f4")
    # Same finite boundary as normalize_to_acescg; band temporaries stay bounded.
    from .color import sanitize_finite_array
    for row in range(0, pixels.shape[0], 128):
        pixels[row:row+128] = sanitize_finite_array(pixels[row:row+128])
    h, w = pixels.shape[:2]
    authored = not decoder_normalized and color.display_referred_sdr(metadata["color_space"], metadata["transfer_function"], suffix)
    matrix_space = "BT.2020" if transfer in {"PQ", "HLG"} else operation_space
    matrix = color.normalize_to_acescg(np.eye(3, dtype=np.float32), matrix_space, "LINEAR").T
    # Grade asks the source colourspace to decode "sRGB"; BT.2020 uses
    # its own (BT.709-coefficient) curve, without clipping float highlights.
    if transfer == "sRGB" and space == color.BT2020_COLOURSPACE:
        transfer = "BT.2020"
    scale = .18 if linear_reference == "diffuse_white_1_0" else 1.
    descriptor = SourceImageDescriptor(filename=path.name, suffix=suffix, width=w, height=h, channels=3,
        dtype="float32", source_color_space=metadata.get("source_color_space_label",metadata["color_space"]),
        transfer_function=metadata["transfer_function"], linear_reference=linear_reference,
        interpretation_mode="manual" if override else "auto", color_space_confident=True)
    if _identity(path) != identity: raise ValueError("Photo changed during RGB decode.")
    header = {"rgb": True, "adapter_version": VERSION, "path": str(path), "identity": identity,
        "width": w, "height": h, "flip": 0, "mosaic_bytes": pixels.nbytes,
        "sample_stride": max(1,int(np.ceil(np.sqrt(w*h/2_000_000)))),
        "layout": {"order":"HWC", "channels":metadata.get("selected_rgb_channels",["R","G","B"]),
            "dtype":"float32", "effective_bits":facts.get("bits_per_sample",facts.get("effective_bits",32)),
            "decoder_dtype":metadata.get("bit_depth"), "row_stride":pixels.strides[0],
            "decoder_code_range": [int(np.iinfo(metadata["bit_depth"]).min),int(np.iinfo(metadata["bit_depth"]).max)] if str(metadata.get("bit_depth","")).startswith(("uint","int")) else None,
            "code_range":None, "ownership":"request-owned", "alpha":"discarded by Grade decoder",
            "data_window":facts.get("dataWindow",[0,0,w,h]), "display_window":facts.get("displayWindow",[0,0,w,h]),
            "origin":facts.get("dataWindow",[0,0])[:2], "decoder_facts":facts},
        "orientation":{"original":facts.get("orientation",1), "applied":suffix in {".jxl", ".avif", ".heic", ".heif"}},
        "colour":{"primaries":operation_space, "transfer":transfer, "decoder_normalized":bool(decoder_normalized and override),
            "grade_decoder_normalized":decoder_normalized,
            "eotf_applied":bool(decoder_normalized and override), "matrix_applied":bool(decoder_normalized and override), "reference_scale_applied":False,
            "original_interpretation":original_interpretation, "reference_white_nits":inputs["hdr_reference_white_nits"],
            "linear_reference":linear_reference, "authored_sdr":authored, "scale":scale,
            "decoder_metadata":metadata, "descriptor":descriptor.model_dump(mode="json"), "override":override},
        "rgb_to_acescg":matrix.tolist(), "acescg_to_srgb":_ACESCG_TO_LINEAR_SRGB.T.tolist(),
        "acescg_to_bt2020":_ACESCG_TO_LINEAR_BT2020.T.tolist(), "decode_ms":decode_ms,
        "decoder_version":loader.SOURCE_DECODER_VERSION, "colour_version":loader.SOURCE_COLOR_TRANSFORM_VERSION,
    }
    parts = [memoryview(pixels).cast("B")]
    if reference is not None:
        reference = np.ascontiguousarray(reference, dtype="<f4")
        if reference.shape != pixels.shape:
            raise NotEligible("Gain-map AVIF renditions disagree on dimensions")
        reference_matrix = color.normalize_to_acescg(np.eye(3,dtype=np.float32),
            metadata["sdr_sample_color_space"], "LINEAR").T
        header["sdr_reference"] = dict(offset=pixels.nbytes, bytes=reference.nbytes,
            width=w,height=h,dtype="float32",transfer=metadata["sdr_sample_transfer_function"],
            rgb_to_acescg=reference_matrix.tolist())
        parts.append(memoryview(reference).cast("B"))
    return header, parts


def developed(cache, path, header, payload):
    from .sessions import _sha256_file
    path = Path(path).resolve(strict=True)
    if _identity(path) != header["identity"]:
        raise ValueError("Photo changed during RGB preparation.")
    h, w = int(header["height"]), int(header["width"])
    authored = header["colour"].get("authored_sdr", True)
    reference_present = authored or header.get("has_sdr_reference", False)
    plane_count = 6 if reference_present else 3
    if len(payload) != h * w * plane_count * 4:
        raise ValueError("Incomplete RGB scene/rendition payload.")
    planes = np.frombuffer(payload, dtype="<f4").reshape(plane_count, h, w)
    if not np.all(np.isfinite(planes)):
        raise ValueError("RGB GPU preparation produced invalid samples.")
    pixels = np.ascontiguousarray(planes[:3].transpose(1, 2, 0))
    reference = np.ascontiguousarray(planes[3:].transpose(1, 2, 0)) if reference_present else None
    peak, robust = header["peaks"], header["robust"]
    # SDR JPEG/PNG cannot gain HDR headroom through a colour matrix.
    analysis = HDRAnalysis(classification="SDR_ONLY", badge_message="Authored SDR file rendition.",
        peak_stops_above_diffuse_white=max(0.0,float(np.log2(max(peak["peak"],1e-20)/.18))), peak_linear=peak["peak"], robust_peak_linear=robust["channel"],
        peak_luma_linear=peak["peak_luma"], robust_peak_luma_linear=robust["luma"],
        peak_bt2020_linear=peak["peak_bt2020"], robust_peak_bt2020_linear=robust["bt2020"])
    white = header["colour"]["reference_white_nits"]
    # A one-value reference supplies the exact full-source SDR peak to defaults.
    colour = header["colour"]
    authored = colour.get("authored_sdr", True)
    if colour.get("descriptor"):
        from .analysis import classify_hdr
        # Classification depends on the exact full-source peak and decoder facts.
        analysis = classify_hdr(np.full((1,1,3),peak["peak"],dtype=np.float32), colour["decoder_metadata"], path.suffix.lower())
        analysis = analysis.model_copy(update={"peak_luma_linear":peak["peak_luma"],
            "peak_bt2020_linear":peak["peak_bt2020"], "robust_peak_linear":robust["channel"],
            "robust_peak_luma_linear":robust["luma"], "robust_peak_bt2020_linear":robust["bt2020"]})
    if not reference_present: reference = None
    look = starting_adjustments(analysis, np.array([peak["sdr"]], dtype=np.float32) if reference_present else None, white)
    source = SourceImageDescriptor(filename=path.name, suffix=path.suffix.lower(),
        width=header["source_width"], height=header["source_height"], channels=3, dtype="float32",
        source_color_space="sRGB", transfer_function="sRGB")
    if colour.get("descriptor"): source = SourceImageDescriptor.model_validate(colour["descriptor"])
    fingerprint = _sha256_file(path)
    document = EditDocument(hdr_reference_white_nits=white, global_adjustments=look,
        interpretation_override=SourceInterpretationOverride.model_validate(colour.get("override",{})),
        source=SourceReference(filename=path.name, durable_path=str(path), byte_size=path.stat().st_size,
            fingerprint_sha256=fingerprint,
            **({"raw_import_settings":header["raw_import_settings"]} if header.get("raw_import_settings") else {}),
            luminance=describe_source_luminance(source, {**colour.get("decoder_metadata",{}), "sdr_file_rendition": authored}, has_authored_sdr=reference_present)))
    if _identity(path) != header["identity"]:
        raise ValueError("Photo changed during RGB preparation.")
    metadata = {"route": "library-live", "renderer": "gpu", "rgb_adapter": VERSION,
        "starting_look": look.model_dump(mode="json"), "default_document": document.model_dump(mode="json"),
        "source_width": source.width, "source_height": source.height,
        "source_fingerprint_sha256": fingerprint, "gpu_memory_peak_bytes": header["memory_peak_bytes"],
        "source_analysis": analysis.model_dump(mode="json"), "rgb_contract": {"colour": header["colour"], "layout": header.get("layout"), "orientation": header.get("orientation")},
        **({"dng_tiles": header["dng_diagnostics"]} if header.get("dng_diagnostics") else {}),
        "source_timings_ms": header.get("timing_ms")}
    return cache.build(path, header["edge"], header["source_quality"], decoded=(pixels, reference, metadata))
