"""Non-shipping JPEG Ultra HDR stage, sensitivity and own-source experiments."""
from __future__ import annotations

import argparse
from dataclasses import asdict
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from hdr_finisher import exporters as writer
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.binaries import resolve_binary
from hdr_finisher.color import linear_srgb_to_acescg, linear_bt2020_to_acescg
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.gainmap_decoders import decode_ultrahdr_jpeg, parse_jpeg_gain_map_probe
from hdr_finisher.hdr_ceiling import channel_nits, ENCODING_ALLOWANCE
from hdr_finisher.loader import load_image
from hdr_finisher.models import AdjustmentState, ExportSettings, PreviewKind

UPSTREAM = "ad4a92eea0d2f39f18b5ecae3165fdd56c6a478b"


def run(command, env=None):
    result = subprocess.run([str(value) for value in command], capture_output=True, text=True, env=env)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result.stdout + result.stderr


def instrument(source):
    replacements = {
        "lib/src/jpegr.cpp": [
            ("#include <condition_variable>", "#include <cstdio>\n#include <cstdlib>\n#include <condition_variable>"),
            ("  if (!kWriteXmpMetadata) {\n    std::shared_ptr<DataStruct> icc", "  if (const char* dump = getenv(\"HDRF_RESEARCH_MAP\")) {\n    FILE* file = fopen(dump, \"wb\");\n    if (!file) abort();\n    for (unsigned row = 0; row < gainmap_img->h; ++row) {\n      fwrite(static_cast<uint8_t*>(gainmap_img->planes[0]) + row * gainmap_img->stride[0] * 3, 1, gainmap_img->w * 3, file);\n    }\n    fclose(file);\n  }\n  if (!kWriteXmpMetadata) {\n    std::shared_ptr<DataStruct> icc"),
            ("    std::function<void()> encodeMap =", "    if (const char* dump = getenv(\"HDRF_RESEARCH_LOG_GAIN\")) {\n      FILE* file = fopen(dump, \"wb\");\n      if (!file) abort();\n      fwrite(gainmap_data, sizeof(float), map_width * map_height * 3, file);\n      fclose(file);\n    }\n    if (getenv(\"HDRF_RESEARCH_FIXED_RANGE\")) {\n      std::fill_n(gainmap_min, 3, -4.0f);\n      std::fill_n(gainmap_max, 3, 4.0f);\n    }\n    std::function<void()> encodeMap ="),
            ("  JobQueue jobQueue;\n  std::function<void()> applyRecMap =", "  auto researchRead = [sdr_intent](const char* key) {\n    std::vector<uint8_t> values;\n    if (const char* path = getenv(key)) {\n      values.resize(sdr_intent->w * sdr_intent->h * 3);\n      FILE* file = fopen(path, \"rb\");\n      if (!file || fread(values.data(), 1, values.size(), file) != values.size()) abort();\n      fclose(file);\n    }\n    return values;\n  };\n  auto research_base = researchRead(\"HDRF_RESEARCH_BASE_INPUT\");\n  auto research_gain = researchRead(\"HDRF_RESEARCH_MAP_INPUT\");\n  JobQueue jobQueue;\n  std::function<void()> applyRecMap ="),
            ("map_scale_factor, get_pixel_fn]() -> void {", "map_scale_factor, get_pixel_fn, &research_base, &research_gain]() -> void {"),
            ("          Color rgb_gamma_sdr = p3YuvToRgb(yuv_gamma_sdr);", "          Color rgb_gamma_sdr = p3YuvToRgb(yuv_gamma_sdr);\n          if (!research_base.empty()) {\n            size_t index = (x + y * width) * 3;\n            rgb_gamma_sdr.r = research_base[index] / 255.0f;\n            rgb_gamma_sdr.g = research_base[index + 1] / 255.0f;\n            rgb_gamma_sdr.b = research_base[index + 2] / 255.0f;\n          }"),
            ("          size_t pixel_idx = x + y * dest->stride[UHDR_PLANE_PACKED];", "          if (!research_gain.empty()) {\n            size_t index = (x + y * width) * 3;\n            Color gain;\n            gain.r = research_gain[index] / 255.0f;\n            gain.g = research_gain[index + 1] / 255.0f;\n            gain.b = research_gain[index + 2] / 255.0f;\n            rgb_hdr = applyGainLUT(rgb_sdr, gain, gainLUT, gainmap_metadata);\n          }\n          size_t pixel_idx = x + y * dest->stride[UHDR_PLANE_PACKED];"),
        ],
        "examples/ultrahdr_app.cpp": [
            ("  RET_IF_ERR(uhdr_dec_set_image(handle, &mUhdrImage))", "  if (const char* boost = getenv(\"HDRF_RESEARCH_BOOST\")) {\n    RET_IF_ERR(uhdr_dec_set_out_max_display_boost(handle, atof(boost)))\n  }\n  RET_IF_ERR(uhdr_dec_set_image(handle, &mUhdrImage))"),
        ],
    }
    for relative, changes in replacements.items():
        path = source / relative
        text = path.read_text()
        for old, new in changes:
            if text.count(old) != 1:
                raise ValueError(f"Unexpected pinned upstream source: {relative}: {old}")
            text = text.replace(old, new)
        path.write_text(text)


def metric(first, second, lane):
    value = compare_finished_pixels(first, second, lane)
    return {**asdict(value), "within_existing_1_3": value.passed}


def eotf(codes):
    encoded = codes.astype(np.float32) / 255
    return np.where(encoded <= .04045, encoded / 12.92, ((encoded + .055) / 1.055) ** 2.4)


def rgb(jpeg):
    with Image.open(BytesIO(jpeg)) as image:
        return np.array(image.convert("RGB"))


def jpeg(codes, quality=100):
    buffer = BytesIO()
    Image.fromarray(codes).save(buffer, format="JPEG", quality=quality, subsampling=0)
    return buffer.getvalue()


def probe(binary, path):
    text = run([binary, "-m", 1, "-j", path, "-P"])
    return text, parse_jpeg_gain_map_probe(text)


def repack(folder, binary, base, gain, text, name):
    primary = folder / f"{name}-base.jpg"
    secondary = folder / f"{name}-map.jpg"
    config = folder / f"{name}.cfg"
    output = folder / f"{name}.jpg"
    primary.write_bytes(base)
    secondary.write_bytes(gain)
    config.write_text(writer._ultrahdr_metadata_config(text))
    run([binary, "-m", 0, "-i", primary, "-g", secondary, "-f", config, "-z", output])
    return output


def decode_boost(binary, path, shape, metadata, boost, overrides=None):
    raw = path.with_suffix(".raw")
    env = {**os.environ, "HDRF_RESEARCH_BOOST": str(boost)}
    env.update(overrides or {})
    run([binary, "-m", 1, "-j", path, "-o", 0, "-O", 4, "-z", raw], env)
    samples = np.fromfile(raw, dtype="<f2").astype(np.float32).reshape(*shape, 4)[..., :3] * .18
    raw.unlink()
    transform = linear_srgb_to_acescg if metadata.use_base_color_space else linear_bt2020_to_acescg
    return np.clip(transform(samples), 0, None).astype(np.float32)


def reconstruct(base, gain_codes, metadata, weight=1):
    low, high = np.log2(metadata.min_content_boost), np.log2(metadata.max_content_boost)
    gains = low + (high - low) * (gain_codes.astype(np.float32) / 255) ** (1 / metadata.gamma)
    samples = (base + metadata.offset_sdr) * np.exp2(gains * weight) - metadata.offset_hdr
    return np.clip(linear_srgb_to_acescg(samples * .18), 0, None).astype(np.float32)


def encode(folder, binary, hdr, sdr, *, quality=95, map_quality=95, scale="full", chroma="444", filtering="guided", decoded_fit=False, fixed_range=False, codes=None):
    folder.mkdir()
    hdr_raw, peak = writer._prepare_hdr_linear_rgba_f16(hdr)
    sdr_codes = writer._floor_ultrahdr_base(writer._linear_to_srgb8(sdr, dither="off"), hdr) if codes is None else codes
    hdr_path, sdr_path, base_path, initial = [folder / name for name in ("hdr.raw", "sdr.raw", "base.jpg", "initial.jpg")]
    hdr_path.write_bytes(hdr_raw.tobytes())
    writer._write_sdr_jpeg_pixels(base_path, sdr_codes, quality=quality, chroma_subsampling=chroma)
    intent_codes = rgb(base_path.read_bytes()) if decoded_fit else sdr_codes
    writer._write_sdr_rgba8888_pixels(sdr_path, intent_codes)
    command = writer._build_ultrahdr_encode_command(binary, hdr_path, sdr_path, initial, sdr_jpeg_path=base_path,
        width=hdr.shape[1], height=hdr.shape[0], quality=quality, gain_map_quality=100, gain_map_scale=scale, target_peak_nits=peak)
    map_raw, log_raw = folder / "map.raw", folder / "log.raw"
    env = {**os.environ, "HDRF_RESEARCH_MAP": str(map_raw), "HDRF_RESEARCH_LOG_GAIN": str(log_raw)}
    if fixed_range:
        env["HDRF_RESEARCH_FIXED_RANGE"] = "1"
    run(command, env)
    text, metadata = probe(binary, initial)
    base, gain = writer._split_ultrahdr_jpegs(initial.read_bytes())
    if filtering == "none":
        final = initial
    else:
        kwargs = {"quality": map_quality}
        if filtering == "weak":
            kwargs["amount"] = .25
        if filtering == "edge":
            kwargs["radius"] = 1
            kwargs["epsilon"] = 1e-5
        filtered = writer._denoised_ultrahdr_gain_map_jpeg(base, gain, **kwargs)
        final = repack(folder, binary, base, filtered, text, "final")
    hdr_decoded, sdr_decoded, _ = decode_ultrahdr_jpeg(final)
    map_shape = rgb(gain).shape
    return {"path": final, "base": base, "gain": gain, "text": text, "metadata": metadata,
        "codes": intent_codes, "raw_map": np.fromfile(map_raw, dtype=np.uint8).reshape(map_shape),
        "log_gain": np.fromfile(log_raw, dtype=np.float32).reshape(map_shape),
        "hdr": hdr_decoded, "sdr": sdr_decoded, "bytes": final.stat().st_size,
        "metadata_json": metadata.model_dump(mode="json")}


def fidelity(case, hdr, sdr, binary):
    metadata = case["metadata"]
    full = decode_boost(binary, case["path"], hdr.shape[:2], metadata, metadata.hdr_capacity_max)
    partial_boost = float(np.sqrt(metadata.hdr_capacity_max))
    partial = decode_boost(binary, case["path"], hdr.shape[:2], metadata, partial_boost)
    from hdr_finisher.color import acescg_to_linear_srgb
    hdr_srgb = np.maximum(acescg_to_linear_srgb(hdr / .18), 0)
    partial_reference = np.sqrt((np.maximum(sdr, 0) + metadata.offset_sdr) * (hdr_srgb + metadata.offset_hdr)) - metadata.offset_hdr
    partial_reference = np.clip(linear_srgb_to_acescg(partial_reference * .18), 0, None).astype(np.float32)
    return {"hdr": metric(hdr, case["hdr"], "hdr"), "sdr": metric(sdr, case["sdr"], "sdr"),
        "bytes": case["bytes"], "decoded_peak_nits": float(channel_nits(case["hdr"]).max()),
        "partial_boost": partial_boost, "partial_hdr": metric(partial_reference, partial, "hdr"),
        "instrumented_decoder_vs_shipping": metric(full, case["hdr"], "hdr"), "metadata": case["metadata_json"]}


def review_crop(case, hdr, sdr, binary, output, name):
    from PIL import ImageDraw
    from hdr_finisher.color import acescg_to_linear_srgb
    luminance = channel_nits(hdr)
    gradient = np.zeros_like(luminance)
    gradient[:, 1:] += np.abs(np.diff(luminance, axis=1))
    gradient[1:, :] += np.abs(np.diff(luminance, axis=0))
    row, column = np.unravel_index(np.argmax(gradient), gradient.shape)
    left = max(0, min(column - 32, hdr.shape[1] - 64))
    top = max(0, min(row - 32, hdr.shape[0] - 64))
    region = np.s_[top:top + 64, left:left + 64]
    metadata = case["metadata"]
    partial = decode_boost(binary, case["path"], hdr.shape[:2], metadata, np.sqrt(metadata.hdr_capacity_max))
    hdr_srgb = np.maximum(acescg_to_linear_srgb(hdr / .18), 0)
    partial_reference = np.sqrt((np.maximum(sdr, 0) + metadata.offset_sdr) * (hdr_srgb + metadata.offset_hdr)) - metadata.offset_hdr
    panels = [("SDR source", sdr, False), ("SDR decoded", case["sdr"], False),
        ("Full source", hdr, True), ("Full decoded", case["hdr"], True),
        ("Half-log reference", linear_srgb_to_acescg(partial_reference * .18), True), ("Half-log decoded", partial, True)]
    canvas = Image.new("RGB", (6 * 256, 292), "white")
    draw = ImageDraw.Draw(canvas)
    for index, (label, pixels, hdr_lane) in enumerate(panels):
        sample = np.maximum(acescg_to_linear_srgb(pixels[region]) / .18, 0) if hdr_lane else pixels[region]
        if hdr_lane:
            sample = sample / (1 + sample)
        codes = writer._linear_to_srgb8(sample, dither="off")
        canvas.paste(Image.fromarray(codes).resize((256, 256), Image.Resampling.NEAREST), (index * 256, 36))
        draw.text((index * 256 + 5, 5), label, fill="black")
    canvas.save(output / f"{name}-crop.png")
    return {"x": int(left), "y": int(top), "size": 64, "selection": "largest source luminance edge, not largest error", "preview": "SDR simulation, HDR panels Reinhard per channel; not an HDR screenshot"}


def stage_metrics(case, hdr):
    base = eotf(case["codes"])
    metadata = case["metadata"]
    lossless_gain = (base + metadata.offset_sdr) * np.exp2(case["log_gain"]) - metadata.offset_hdr
    float_image = np.clip(linear_srgb_to_acescg(lossless_gain * .18), 0, None).astype(np.float32)
    quantized = reconstruct(base, case["raw_map"], metadata)
    map_jpeg = reconstruct(base, rgb(case["gain"]), metadata)
    both_jpeg = reconstruct(eotf(rgb(case["base"])), rgb(case["gain"]), metadata)
    return {"float_gain": metric(hdr, float_image, "hdr"), "gain_8bit": metric(hdr, quantized, "hdr"),
        "map_jpeg100": metric(hdr, map_jpeg, "hdr"), "base_jpeg_added": metric(hdr, both_jpeg, "hdr"),
        "formula_vs_native_initial": metric(both_jpeg, decode_ultrahdr_jpeg(case["path"].parent / "initial.jpg")[0], "hdr"),
        "final_filtered": metric(hdr, case["hdr"], "hdr")}


def native_stages(case, hdr, binary):
    result = {}
    folder = case["path"].parent
    raw_base = folder / "decode-base.raw"
    raw_gain = folder / "decode-map.raw"
    raw_base.write_bytes(case["codes"].tobytes())
    raw_gain.write_bytes(case["raw_map"].tobytes())
    metadata = case["metadata"]
    for label, overrides in (("raw_base_raw_map", {"HDRF_RESEARCH_BASE_INPUT": str(raw_base), "HDRF_RESEARCH_MAP_INPUT": str(raw_gain)}),
            ("raw_base_map_jpeg100", {"HDRF_RESEARCH_BASE_INPUT": str(raw_base)}), ("base_jpeg95_raw_map", {"HDRF_RESEARCH_MAP_INPUT": str(raw_gain)}),
            ("both_jpegs_unfiltered", {})):
        pixels = decode_boost(binary, folder / "initial.jpg", hdr.shape[:2], metadata, metadata.hdr_capacity_max, overrides)
        result[label] = metric(hdr, pixels, "hdr")
    return result


def mechanism(case, hdr):
    from hdr_finisher.color import acescg_to_linear_srgb
    half = writer._prepare_hdr_linear_rgba_f16(hdr)[0][..., :3].astype(np.float32)
    half_aces = linear_bt2020_to_acescg(half * .18)
    srgb_linear = acescg_to_linear_srgb(half_aces / .18)
    projected = np.clip(linear_srgb_to_acescg(np.maximum(srgb_linear, 0) * .18), 0, None).astype(np.float32)
    metadata = case["metadata"]
    base = eotf(case["codes"])
    float_reconstructed = np.clip(linear_srgb_to_acescg(((base + metadata.offset_sdr) * np.exp2(case["log_gain"]) - metadata.offset_hdr) * .18), 0, None).astype(np.float32)
    logs = case["log_gain"]
    return {"half_input": metric(hdr, half_aces, "hdr"), "srgb_gamut_projection": metric(hdr, projected, "hdr"),
        "float_gain_vs_gamut_projection": metric(projected, float_reconstructed, "hdr"),
        "negative_srgb_pixel_percent": float(np.mean(np.any(srgb_linear < -1e-5, axis=-1)) * 100),
        "gain_below_min_channel_percent": float(np.mean(logs < np.log2(metadata.min_content_boost) - 1e-5) * 100),
        "gain_above_max_channel_percent": float(np.mean(logs > np.log2(metadata.max_content_boost) + 1e-5) * 100),
        "floor_code_channel_percent": float(np.mean(case["codes"] <= 2) * 100)}


def fixture(binary, output):
    arrays = np.load(ROOT / "output/review/n4-local-match/sharp-matched-floats.npz")
    hdr, sdr = arrays["cpu_hdr"], arrays["cpu_sdr"]
    result = {"shape": list(hdr.shape), "variants": {}, "sensitivity": {}}
    with TemporaryDirectory(prefix="hdrf-jpeg-drift-") as temporary:
        folder = Path(temporary)
        cpu = encode(folder / "cpu", binary, hdr, sdr)
        gpu = encode(folder / "gpu", binary, arrays["gpu_hdr"], arrays["gpu_sdr"])
        result["preencode"] = {lane: metric(arrays[f"cpu_{lane}"], arrays[f"gpu_{lane}"], lane) for lane in ("hdr", "sdr")}
        result["metadata_identical"] = cpu["metadata_json"] == gpu["metadata_json"]
        result["review_crop"] = review_crop(cpu, hdr, sdr, binary, output, "fixture")
        result["gpu_metadata"] = gpu["metadata_json"]
        result["pair"] = {lane: metric(cpu[lane], gpu[lane], lane) for lane in ("hdr", "sdr")}
        result["stages"] = stage_metrics(cpu, hdr)
        result["native_stages"] = native_stages(cpu, hdr, binary)
        result["mechanism"] = mechanism(cpu, hdr)
        result["pair_stages"] = {}
        for label, map_key in (("raw_8bit", "raw_map"), ("map_jpeg100", "gain")):
            pair = []
            for case in (cpu, gpu):
                gain_codes = case[map_key] if map_key == "raw_map" else rgb(case[map_key])
                pair.append(reconstruct(eotf(case["codes"]), gain_codes, case["metadata"]))
            result["pair_stages"][label] = metric(*pair, "hdr")
        result["native_pair_stages"] = {}
        for label, raw_gain, raw_base in (("raw_base_raw_map", True, True), ("raw_base_map_jpeg100", False, True), ("both_jpegs_unfiltered", False, False)):
            pair = []
            for case in (cpu, gpu):
                overrides = {}
                parent = case["path"].parent
                if raw_base:
                    base_path = parent / "decode-base.raw"
                    base_path.write_bytes(case["codes"].tobytes())
                    overrides["HDRF_RESEARCH_BASE_INPUT"] = str(base_path)
                if raw_gain:
                    map_path = parent / "decode-map.raw"
                    map_path.write_bytes(case["raw_map"].tobytes())
                    overrides["HDRF_RESEARCH_MAP_INPUT"] = str(map_path)
                pair.append(decode_boost(binary, parent / "initial.jpg", hdr.shape[:2], case["metadata"], case["metadata"].hdr_capacity_max, overrides))
            result["native_pair_stages"][label] = metric(*pair, "hdr")
        result["gpu_fidelity"] = fidelity(gpu, arrays["gpu_hdr"], arrays["gpu_sdr"], binary)
        result["variants"]["baseline"] = fidelity(cpu, hdr, sdr, binary)
        result["map_pair"] = {"raw_codes_different": int(np.count_nonzero(cpu["raw_map"] != gpu["raw_map"])),
            "jpeg_codes_different": int(np.count_nonzero(rgb(cpu["gain"]) != rgb(gpu["gain"]))),
            "channels": int(cpu["raw_map"].size),
            "log_gain_difference_p999_stops": float(np.percentile(np.abs(cpu["log_gain"] - gpu["log_gain"]), 99.9))}
        for name, options in variants().items():
            case = encode(folder / name, binary, hdr, sdr, **options)
            result["variants"][name] = fidelity(case, hdr, sdr, binary)
            if name == "fixed_range":
                fixed_gpu = encode(folder / "fixed_range_gpu", binary, arrays["gpu_hdr"], arrays["gpu_sdr"], **options)
                result["fixed_range_pair"] = metric(case["hdr"], fixed_gpu["hdr"], "hdr")
        for label, base_case, gain_case in (("same_base", cpu, gpu), ("same_map", gpu, cpu)):
            path = repack(folder, binary, base_case["base"], writer._split_ultrahdr_jpegs(gain_case["path"].read_bytes())[1], gain_case["text"], label)
            result[label] = metric(cpu["hdr"], decode_ultrahdr_jpeg(path)[0], "hdr")
        rng = np.random.default_rng(20261116)
        half = writer._prepare_hdr_linear_rgba_f16(hdr)[0][..., :3]
        raised = np.nextafter(half, np.float16(np.inf), dtype=np.float16)
        perturbed_hdr = linear_bt2020_to_acescg(raised.astype(np.float32) * .18)
        codes = cpu["codes"]
        noise = rng.integers(-1, 2, codes.shape)
        noisy_codes = np.clip(codes.astype(np.int16) + noise, 0, 255).astype(np.uint8)
        sparse_noise = noise * (rng.random(codes.shape) < 1 / 32)
        sparse_codes = np.clip(codes.astype(np.int16) + sparse_noise, 0, 255).astype(np.uint8)
        for name, changed_hdr, changed_codes in (("hdr_one_half_ulp", perturbed_hdr, codes),
                ("sdr_one_code_noise", hdr, noisy_codes), ("both_one_lsb", perturbed_hdr, noisy_codes),
                ("sdr_sparse_one_code", hdr, sparse_codes), ("both_sparse_one_lsb", perturbed_hdr, sparse_codes)):
            case = encode(folder / name, binary, changed_hdr, sdr, codes=changed_codes)
            result["sensitivity"][name] = {"input_hdr": metric(hdr, changed_hdr, "hdr"),
                "input_sdr": metric(eotf(codes), eotf(changed_codes), "sdr"),
                "decoded_hdr": metric(cpu["hdr"], case["hdr"], "hdr"),
                "decoded_sdr": metric(cpu["sdr"], case["sdr"], "sdr"),
                "metadata_identical": case["metadata_json"] == cpu["metadata_json"]}
        settings = ExportSettings(format="jpeg_ultrahdr", quality=95, jpeg_chroma_subsampling="444", jpeg_gain_map_quality=95, jpeg_gain_map_scale="full", dithering="off")
        result["delivered"] = {}
        for renderer in ("cpu", "gpu"):
            path = folder / f"delivered-{renderer}.jpg"
            notes = []
            writer.write_jpeg_gainmap_renditions(path, arrays[f"{renderer}_hdr"], arrays[f"{renderer}_sdr"], settings,
                ceiling_nits=1000, encoding_allowance=ENCODING_ALLOWANCE, notes=notes)
            decoded_hdr, decoded_sdr, _ = decode_ultrahdr_jpeg(path)
            result["delivered"][renderer] = {"hdr": metric(arrays[f"{renderer}_hdr"], decoded_hdr, "hdr"),
                "sdr": metric(arrays[f"{renderer}_sdr"], decoded_sdr, "sdr"), "notes": notes,
                "peak_nits": float(channel_nits(decoded_hdr).max()), "bytes": path.stat().st_size}
        result["repeat"] = encode(folder / "repeat", binary, hdr, sdr)["path"].read_bytes() == cpu["path"].read_bytes()
        shipping_path = folder / "shipping.jpg"
        writer._write_jpeg_gainmap_once(shipping_path, hdr, sdr, settings)
        result["instrumented_encoder_equals_shipping_bytes"] = shipping_path.read_bytes() == cpu["path"].read_bytes()
    (output / "fixture.json").write_text(json.dumps(result, indent=2))
    return result


def variants():
    return {"unfiltered": {"filtering": "none"}, "quality100": {"quality": 100, "map_quality": 100},
        "half_map": {"scale": "half"}, "base420": {"chroma": "420"},
        "weak_filter": {"filtering": "weak"}, "edge_filter": {"filtering": "edge"},
        "fixed_range": {"fixed_range": True}, "decoded_fit": {"decoded_fit": True},
        "decoded_fit100_unfiltered": {"decoded_fit": True, "quality": 100, "filtering": "none"}}


def photos(binary, photos_root, output, edge, stages_only=False):
    names = ("IMG_3129.CR2", "IMG_0790.CR2", "5M071612_finished.avif", "-4_stops_exposure_PQ_Rec_2020_DSC08883_03.avif")
    manifest = json.loads((ROOT / "tests/test-photos.manifest.json").read_text())
    approved = {item["name"]: item for item in manifest["files"]}
    results = json.loads((output / "photos.json").read_text()) if stages_only else {}
    for name in names:
        path = photos_root / name
        digest = hashlib.file_digest(path.open("rb"), "sha256").hexdigest()
        if digest != approved[name]["sha256"]:
            raise ValueError(f"Not the approved photo: {name}")
        print(f"Measuring {name}", flush=True)
        image, _, _, _, authored_sdr = load_image(path, library_edge=edge, analyze_hdr=False)
        height, width = image.shape[:2]
        ratio = min(1, edge / max(height, width))
        size = (max(8, int(width * ratio) // 2 * 2), max(8, int(height * ratio) // 2 * 2))
        def resize(array):
            return np.stack([np.asarray(Image.fromarray(array[..., channel]).resize(size, Image.Resampling.LANCZOS)) for channel in range(3)], -1)
        image = resize(image)
        authored_sdr = resize(authored_sdr) if authored_sdr is not None else None
        adjustments = AdjustmentState()
        adjustments.hdr.highlight_section_enabled = True
        adjustments.hdr.highlight_compression_mode = "fixed_cap"
        adjustments.hdr.highlight_compression_target_nits = 1000
        hdr = apply_adjustments(image, adjustments, PreviewKind.HDR)
        sdr = apply_adjustments(image, adjustments, PreviewKind.SDR, sdr_reference_image=authored_sdr)
        record = {"sha256": digest, "shape": list(hdr.shape), "source_peak_nits": float(channel_nits(hdr).max()), "variants": {}}
        with TemporaryDirectory(prefix="hdrf-jpeg-photo-") as temporary:
            folder = Path(temporary)
            cpu = encode(folder / "baseline", binary, hdr, sdr)
            record["stages"] = stage_metrics(cpu, hdr)
            record["native_stages"] = native_stages(cpu, hdr, binary)
            record["mechanism"] = mechanism(cpu, hdr)
            record["review_crop"] = review_crop(cpu, hdr, sdr, binary, output, path.stem)
            if stages_only:
                results[name]["native_stages"] = record["native_stages"]
                results[name]["mechanism"] = record["mechanism"]
                results[name]["review_crop"] = record["review_crop"]
                (output / "photos.json").write_text(json.dumps(results, indent=2))
                continue
            record["variants"]["baseline"] = fidelity(cpu, hdr, sdr, binary)
            for label in ("unfiltered", "quality100", "half_map", "fixed_range", "decoded_fit100_unfiltered"):
                case = encode(folder / label, binary, hdr, sdr, **variants()[label])
                record["variants"][label] = fidelity(case, hdr, sdr, binary)
            preview = writer._linear_to_srgb8(sdr, dither="off")
            Image.fromarray(preview).save(output / f"{path.stem}-sdr.png")
            settings = ExportSettings(format="jpeg_ultrahdr", quality=95, jpeg_chroma_subsampling="444", jpeg_gain_map_quality=95, jpeg_gain_map_scale="full", dithering="off")
            delivery = folder / "delivered.jpg"
            try:
                writer.write_jpeg_gainmap_renditions(delivery, hdr, sdr, settings, ceiling_nits=1000, encoding_allowance=ENCODING_ALLOWANCE)
                final_hdr, final_sdr, _ = decode_ultrahdr_jpeg(delivery)
                record["delivered"] = {"hdr": metric(hdr, final_hdr, "hdr"), "sdr": metric(sdr, final_sdr, "sdr"),
                    "peak_nits": float(channel_nits(final_hdr).max()), "bytes": delivery.stat().st_size}
            except Exception as error:
                record["delivered"] = {"refused": str(error)}
        results[name] = record
        (output / "photos.json").write_text(json.dumps(results, indent=2))
    return results


def paired_captures(binary, capture_root, output):
    records = json.loads((capture_root / "photos.json").read_text())
    results = {}
    for record in records:
        if record["folder"] not in ("5M071612_finished", "DSC08883"):
            continue
        capture = capture_root / record["folder"] / "floats.npz"
        arrays = np.load(capture)
        result = {"capture": str(capture), "provenance": record,
            "recipe": "Sibling shared-renderer capture: 1000-nit Fixed cap, SDR exposure -0.15, no saved grade", "renderers": {}}
        result["preencode"] = {lane: metric(arrays[f"cpu_{lane}"], arrays[f"gpu_{lane}"], lane) for lane in ("hdr", "sdr")}
        with TemporaryDirectory(prefix="hdrf-jpeg-paired-") as temporary:
            folder = Path(temporary)
            cases = {}
            settings = ExportSettings(format="jpeg_ultrahdr", quality=95, jpeg_chroma_subsampling="444", jpeg_gain_map_quality=95, jpeg_gain_map_scale="full", dithering="off")
            for renderer in ("cpu", "gpu"):
                hdr, sdr = arrays[f"{renderer}_hdr"], arrays[f"{renderer}_sdr"]
                case = encode(folder / renderer, binary, hdr, sdr)
                result["renderers"][renderer] = fidelity(case, hdr, sdr, binary)
                path = folder / f"{renderer}-delivered.jpg"
                writer.write_jpeg_gainmap_renditions(path, hdr, sdr, settings, ceiling_nits=1000, encoding_allowance=ENCODING_ALLOWANCE)
                final_hdr, final_sdr, _ = decode_ultrahdr_jpeg(path)
                result["renderers"][renderer]["delivered"] = {"hdr": metric(hdr, final_hdr, "hdr"), "sdr": metric(sdr, final_sdr, "sdr"),
                    "peak_nits": float(channel_nits(final_hdr).max()), "bytes": path.stat().st_size}
                cases[renderer] = (final_hdr, final_sdr)
            result["delivered_pair"] = {lane: metric(cases["cpu"][index], cases["gpu"][index], lane) for index, lane in enumerate(("hdr", "sdr"))}
        results[record["name"]] = result
        (output / "paired-photos.json").write_text(json.dumps(results, indent=2))
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", type=Path)
    parser.add_argument("--binary", type=Path)
    parser.add_argument("--photos-root", type=Path)
    parser.add_argument("--paired-root", type=Path)
    parser.add_argument("--edge", type=int, default=1024)
    parser.add_argument("--stages-only", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "output/review/jpeg-encoding-drift")
    args = parser.parse_args()
    if args.instrument:
        instrument(args.instrument)
        return
    if not args.binary:
        parser.error("--binary must name a separately built, instrumented pinned CLI")
    args.output.mkdir(parents=True, exist_ok=True)
    if args.paired_root:
        paired_captures(args.binary, args.paired_root, args.output)
    elif args.photos_root:
        photos(args.binary, args.photos_root, args.output, args.edge, args.stages_only)
    else:
        fixture(args.binary, args.output)
    print("Completed; measurements in", args.output)


if __name__ == "__main__":
    main()
