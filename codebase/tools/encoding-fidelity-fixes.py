"""Opt-in fidelity experiments; never install settings or replace bundled encoders."""
import argparse
from contextlib import contextmanager
from dataclasses import asdict
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory

import imagecodecs
import numpy as np

from hdr_finisher import exporters
from hdr_finisher.binaries import resolve_binary
from hdr_finisher.color import acescg_to_linear_bt2020, acescg_to_linear_srgb, linear_bt2020_to_acescg, normalize_to_acescg
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.hdr_ceiling import channel_nits, decoded_channel_nits, encode_within_ceiling, ENCODING_ALLOWANCE
from hdr_finisher.jpegxl import _pq_oetf, encode_hdr_jpegxl, encode_sdr_jpegxl
from hdr_finisher.loader import load_image
from hdr_finisher.gainmap_decoders import _decode_png_pixels
from hdr_finisher.models import ExportSettings


def metric(source, actual, lane="hdr"):
    value = compare_finished_pixels(source, actual, lane)
    return dict(asdict(value), passed=value.passed)


def replace_once(path, old, new):
    text = path.read_text()
    if text.count(old) != 1:
        raise ValueError(f"Unexpected pinned source: {path}: {old}")
    path.write_text(text.replace(old, new))


def instrument_avif(source):
    gain = source / "src/gainmap.c"
    replace_once(gain, "#include <float.h>", "#include <float.h>\n#include <stdlib.h>")
    replace_once(gain,
        "AVIF_CHECKRES(avifChooseColorSpaceForGainMapMath(baseColorPrimaries, altColorPrimaries, &gainMapMathPrimaries));",
        "AVIF_CHECKRES(avifChooseColorSpaceForGainMapMath(baseColorPrimaries, altColorPrimaries, &gainMapMathPrimaries));\n"
        '    if (getenv("HDRF_FIDELITY_BASE_SPACE")) gainMapMathPrimaries = baseColorPrimaries;')
    replace_once(gain,
        "res = avifFindMinMaxWithoutOutliers(gainMapF[c], numPixels, &gainMapMinLog2[c], &gainMapMaxLog2[c]);",
        "res = avifFindMinMaxWithoutOutliers(gainMapF[c], numPixels, &gainMapMinLog2[c], &gainMapMaxLog2[c]);\n"
        '        if (getenv("HDRF_FIDELITY_FULL_RANGE")) {\n'
        "            gainMapMinLog2[c] = gainMapMaxLog2[c] = gainMapF[c][0];\n"
        "            for (size_t pixel = 1; pixel < numPixels; ++pixel) {\n"
        "                gainMapMinLog2[c] = AVIF_MIN(gainMapMinLog2[c], gainMapF[c][pixel]);\n"
        "                gainMapMaxLog2[c] = AVIF_MAX(gainMapMaxLog2[c], gainMapF[c][pixel]);\n"
        "            }\n        }")
    command = source / "apps/avifgainmaputil/combine_command.cc"
    replace_once(command, "#include <cmath>", "#include <cmath>\n#include <cstdlib>")
    replace_once(command,
        "  result = avifImageComputeGainMap(base_image.get(), alternate_image.get(),",
        "  ImagePtr fitting_base(avifImageCreateEmpty());\n"
        '  const char* decoded_base = std::getenv("HDRF_FIDELITY_DECODED_BASE");\n'
        "  if (decoded_base) {\n"
        "    result = ReadImage(fitting_base.get(), decoded_base, pixel_format, arg_image_read_.depth, true, true);\n"
        "    if (result != AVIF_RESULT_OK) return result;\n  }\n"
        "  result = avifImageComputeGainMap(decoded_base ? fitting_base.get() : base_image.get(), alternate_image.get(),")


@contextmanager
def jpeg_options(decoded_fit=False, smoothing="guided"):
    original_write = exporters._write_sdr_rgba8888_pixels
    original_filter = exporters._denoise_ultrahdr_gain_map

    def write_base(path, pixels):
        if decoded_fit:
            from PIL import Image
            with Image.open(path.parent / "sdr_primary.jpg") as base:
                pixels = np.asarray(base.convert("RGB"))
        return original_write(path, pixels)

    exporters._write_sdr_rgba8888_pixels = write_base
    if smoothing == "none":
        exporters._denoise_ultrahdr_gain_map = lambda source, destination, *args, **kwargs: shutil.copyfile(source, destination)
    try:
        yield
    finally:
        exporters._write_sdr_rgba8888_pixels = original_write
        exporters._denoise_ultrahdr_gain_map = original_filter


def jpeg_write(path, hdr, sdr, quality, fit=False, smoothing="guided"):
    settings = ExportSettings(format="jpeg_ultrahdr", quality=quality, jpeg_chroma_subsampling="444",
                              jpeg_gain_map_quality=quality, jpeg_gain_map_scale="full", dithering="off")
    with jpeg_options(fit, smoothing):
        exporters._write_jpeg_gainmap_once(path, hdr, sdr, settings)


def avif_write(path, hdr, sdr, binary, *, quality=95, scale="half", chroma="420", depth=10,
               fit=False, full_range=False, base_space=False):
    with TemporaryDirectory(prefix="hdrf-avif-options-") as scratch:
        folder = Path(scratch)
        base = folder / "base.y4m"
        alternate = folder / "hdr.y4m"
        exporters._write_sdr_y4m(base, sdr, bit_depth=depth, chroma_subsampling=chroma, dithering="off")
        exporters._write_hdr_y4m(alternate, hdr, bit_depth=depth, chroma_subsampling="444")
        env = {key: value for key, value in os.environ.items() if not key.startswith("HDRF_FIDELITY_")}
        if fit:
            decoded_base = folder / "base.avif"
            subprocess.run([str(resolve_binary("avifenc")), str(base), str(decoded_base), "--cicp", "1/13/1",
                            "-q", str(quality), "-d", str(depth), "-y", chroma, "-s", "6"],
                           check=True, capture_output=True)
            env["HDRF_FIDELITY_DECODED_BASE"] = str(decoded_base)
        if full_range:
            env["HDRF_FIDELITY_FULL_RANGE"] = "1"
        if base_space:
            env["HDRF_FIDELITY_BASE_SPACE"] = "1"
        subprocess.run([str(binary), "combine", str(base), str(alternate), str(path),
                        "--cicp-base", "1/13/1", "--cicp-alternate", "9/16/9",
                        "--depth-gain-map", str(depth), "--yuv-gain-map", "444", "--qgain-map", str(quality),
                        "--downscaling", "1" if scale == "full" else "2", "--max-headroom", "0",
                        "-q", str(quality), "-d", str(depth), "-y", chroma], check=True, capture_output=True, env=env)


def measure_file(path, hdr, sdr):
    loaded = load_image(path)
    result = {"bytes": path.stat().st_size, "hdr": metric(hdr, loaded[0]),
              "peak_nits": float(channel_nits(loaded[0]).max())}
    if loaded[4] is not None:
        result["sdr"] = metric(sdr, loaded[4], "sdr")
    result["gain_map_metadata"] = loaded[2].get("gain_map_metadata")
    return result


def measure_sdr_jxl(sdr, folder):
    result = {}
    for quality in (95, 100):
        path = folder / "sdr.jxl"
        path.write_bytes(encode_sdr_jpegxl(sdr, quality))
        decoded = acescg_to_linear_srgb(load_image(path)[0])
        result[f"q{quality}"] = {"bytes": path.stat().st_size, "sdr": metric(sdr, decoded, "sdr")}
    return result


def preparation_stages(hdr, sdr):
    prepared, _ = exporters._prepare_hdr_linear_rgba_f16(hdr)
    result = {"jpeg_half_float_intent": metric(hdr, linear_bt2020_to_acescg(
        prepared[..., :3].astype(np.float32) * np.float32(.18))), "avif_hdr_yuv": {}}
    for depth in (10, 12):
        yuv = exporters._linear_to_bt2020_pq_yuv(hdr, depth).astype(np.float32)
        scale = float(1 << (depth - 8))
        luma = (yuv[..., 0] - 16 * scale) / (219 * scale)
        blue_difference = (yuv[..., 1] - 128 * scale) / (224 * scale)
        red_difference = (yuv[..., 2] - 128 * scale) / (224 * scale)
        red = luma + 1.4746 * red_difference
        blue = luma + 1.8814 * blue_difference
        green = (luma - .2627 * red - .0593 * blue) / .6780
        pq = np.clip(np.stack([red, green, blue], axis=-1), 0, 1)
        result["avif_hdr_yuv"][str(depth)] = metric(hdr, normalize_to_acescg(pq, "BT.2020", "PQ"))
    base = exporters._linear_to_srgb8(sdr)
    floored = exporters._floor_ultrahdr_base(base, hdr)
    for label, pixels in (("jpeg_sdr_quantized", base), ("jpeg_sdr_floored", floored)):
        encoded = pixels.astype(np.float32) / 255
        linear = np.where(encoded <= .04045, encoded / 12.92, ((encoded + .055) / 1.055) ** 2.4)
        result[label] = metric(sdr, linear, "sdr")
    return result


def avif_decode_precision(path, hdr, binary):
    loaded = load_image(path)
    with TemporaryDirectory(prefix="hdrf-avif-decode-options-") as scratch:
        png = Path(scratch) / "hdr.png"
        subprocess.run([str(binary), "tonemap", str(path), str(png), "--headroom",
                        str(loaded[2]["hdr_capacity_stops"]), "--cicp-output", "9/16/9", "-d", "12"],
                       check=True, capture_output=True)
        pixels = normalize_to_acescg(_decode_png_pixels(png), "BT.2020", "PQ")
    return {"hdr": metric(hdr, pixels), "peak_nits": float(channel_nits(pixels).max())}


def jxl_stages(hdr, folder):
    bt2020 = acescg_to_linear_bt2020(hdr)
    pq = _pq_oetf(np.maximum(bt2020, 0) * np.float32(203 / .18))
    quantized = np.round(pq * 4095).astype(np.uint16)
    result = {"negative_bt2020_fraction": float(np.mean(np.min(bt2020, axis=-1) < 0)),
              "gamut_clip": metric(hdr, linear_bt2020_to_acescg(np.maximum(bt2020, 0))),
              "pq_roundtrip": metric(hdr, normalize_to_acescg(pq, "BT.2020", "PQ")),
              "quantized_12bit": metric(hdr, normalize_to_acescg(quantized.astype(np.float32) / 4095, "BT.2020", "PQ")),
              "variants": {}}
    original = imagecodecs.jpegxl_encode
    for name, quality, distance, heuristics in (("q95", 95, None, None), ("q99", 99, None, None),
            ("lossless12", 100, None, None), ("distance001", 95, .01, None),
            ("q95_no_perceptual", 95, None, False)):
        def encode(pixels, **kwargs):
            if distance is not None:
                kwargs["distance"] = distance
            if heuristics is not None:
                kwargs["perceptualheuristics"] = heuristics
            return original(pixels, **kwargs)
        try:
            imagecodecs.jpegxl_encode = encode
            path = folder / "option.jxl"
            path.write_bytes(encode_hdr_jpegxl(hdr, quality))
            initial = measure_file(path, hdr, None)
            notes = []
            payload = encode_within_ceiling(hdr, 203, lambda pixels: encode_hdr_jpegxl(pixels, quality),
                exporters._decoded_jpegxl_channel_nits, 1000, notes, encoding_allowance=ENCODING_ALLOWANCE)
            path.write_bytes(payload)
            result["variants"][name] = {"initial": initial, "delivered": measure_file(path, hdr, None), "notes": notes}
        except Exception as error:
            result["variants"][name] = {"error": str(error)}
        finally:
            imagecodecs.jpegxl_encode = original
    return result


def input_cases(arguments):
    if not arguments.only_reduced:
        inputs = [("fixture", arguments.captures / "sharp-matched-floats.npz")]
        inputs += [(name, arguments.captures / name / "floats.npz") for name in
                   ("DSC08883", "5M071612_finished", "LR-classic-hdr-source-test-1")]
        for name, source in inputs:
            with np.load(source) as arrays:
                yield name, arrays["cpu_hdr"], arrays["cpu_sdr"]
    if arguments.photos_root:
        from PIL import Image
        from hdr_finisher.adjustments import apply_adjustments
        from hdr_finisher.models import AdjustmentState, PreviewKind
        manifest = json.loads((Path(__file__).resolve().parents[1] / "tests/test-photos.manifest.json").read_text())
        approved = {item["name"]: item["sha256"] for item in manifest["files"]}
        for name in ("IMG_3129.CR2", "IMG_0790.CR2", "5M071612_finished.avif",
                     "-4_stops_exposure_PQ_Rec_2020_DSC08883_03.avif"):
            path = arguments.photos_root / name
            with path.open("rb") as source:
                if hashlib.file_digest(source, "sha256").hexdigest() != approved[name]:
                    raise ValueError(f"Not the approved photo: {name}")
            image, _, _, _, authored_sdr = load_image(path, library_edge=1024, analyze_hdr=False)
            height, width = image.shape[:2]
            ratio = min(1, 1024 / max(height, width))
            size = (max(8, int(width * ratio) // 2 * 2), max(8, int(height * ratio) // 2 * 2))
            def resize(array):
                return np.stack([np.asarray(Image.fromarray(array[..., channel]).resize(size, Image.Resampling.LANCZOS))
                                 for channel in range(3)], axis=-1)
            image = resize(image)
            authored_sdr = resize(authored_sdr) if authored_sdr is not None else None
            adjustments = AdjustmentState()
            adjustments.hdr.highlight_section_enabled = True
            adjustments.hdr.highlight_compression_mode = "fixed_cap"
            adjustments.hdr.highlight_compression_target_nits = 1000
            hdr = apply_adjustments(image, adjustments, PreviewKind.HDR)
            sdr = apply_adjustments(image, adjustments, PreviewKind.SDR, sdr_reference_image=authored_sdr)
            yield name, hdr, sdr


def probe(arguments):
    results = {}
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    for name, hdr, sdr in input_cases(arguments):
        result = {"preparation": preparation_stages(hdr, sdr)}
        with TemporaryDirectory(prefix="hdrf-fidelity-options-") as scratch:
            folder = Path(scratch)
            if "jxl" in arguments.formats:
                result["jxl"] = jxl_stages(hdr, folder)
                result["jxl"]["sdr_separate_file"] = measure_sdr_jxl(sdr, folder)
            if "jpeg" in arguments.formats:
                result["jpeg"] = {}
                for option, quality, fit, smoothing in (("baseline", 95, False, "guided"),
                        ("decoded_base_guided", 95, True, "guided"), ("original_base_unfiltered", 95, False, "none"),
                        ("decoded_base_unfiltered", 95, True, "none"), ("decoded_base_q100_unfiltered", 100, True, "none")):
                    path = folder / "option.jpg"
                    jpeg_write(path, hdr, sdr, quality, fit, smoothing)
                    initial = measure_file(path, hdr, sdr)
                    notes = []
                    settings = ExportSettings(format="jpeg_ultrahdr", quality=quality, jpeg_chroma_subsampling="444",
                        jpeg_gain_map_quality=quality, jpeg_gain_map_scale="full", dithering="off")
                    with jpeg_options(fit, smoothing):
                        exporters.write_jpeg_gainmap_renditions(path, hdr, sdr, settings, ceiling_nits=1000,
                                                               encoding_allowance=ENCODING_ALLOWANCE, notes=notes)
                    result["jpeg"][option] = {"initial": initial, "delivered": measure_file(path, hdr, sdr), "notes": notes}
            if "avif" in arguments.formats:
                binary = arguments.avif_binary or resolve_binary("avifgainmaputil")
                result["avif"] = {}
                options = {"baseline": {}, "full420": {"scale": "full"},
                           "half444": {"chroma": "444"}, "full444": {"scale": "full", "chroma": "444"},
                           "lossless12_full444": {"quality": 100, "depth": 12, "scale": "full", "chroma": "444"}}
                if arguments.avif_binary:
                    options.update(decoded_base_full444={"fit": True, "scale": "full", "chroma": "444"},
                        decoded_base_fullrange={"fit": True, "full_range": True, "scale": "full", "chroma": "444"},
                        decoded_base_lossless12_fullrange={"fit": True, "full_range": True, "quality": 100,
                                                          "depth": 12, "scale": "full", "chroma": "444"},
                        base_space_control={"base_space": True, "scale": "full", "chroma": "444"})
                for option, settings in options.items():
                    path = folder / "option.avif"
                    avif_write(path, hdr, sdr, binary, **settings)
                    result["avif"][option] = {"initial": measure_file(path, hdr, sdr)}
                    if option == "baseline" and arguments.avif_binary:
                        shipping = folder / "shipping.avif"
                        avif_write(shipping, hdr, sdr, resolve_binary("avifgainmaputil"))
                        result["avif"][option]["shipping_byte_identical"] = path.read_bytes() == shipping.read_bytes()
                        if not result["avif"][option]["shipping_byte_identical"]:
                            raise AssertionError("Private AVIF baseline differs from the shipping encoder")
                    notes = []
                    def encode(pixels):
                        avif_write(path, pixels, sdr, binary, **settings)
                        return path
                    encode_within_ceiling(hdr, 203, encode,
                        lambda written: decoded_channel_nits(written, "avif_gain_map"),
                        1000, notes, encoding_allowance=ENCODING_ALLOWANCE)
                    result["avif"][option].update(delivered=measure_file(path, hdr, sdr), notes=notes)
                    result["avif"][option]["decode_12bit_diagnostic"] = avif_decode_precision(path, hdr, binary)
        results[name] = result
        arguments.output.write_text(json.dumps(results, indent=2))
        print(name, json.dumps(result), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument-avif", type=Path)
    parser.add_argument("--avif-binary", type=Path)
    parser.add_argument("--formats", nargs="+", default=["jpeg", "avif", "jxl"], choices=["jpeg", "avif", "jxl"])
    parser.add_argument("--captures", type=Path, default=Path("output/review/encoding-drift-avif-jxl"))
    parser.add_argument("--photos-root", type=Path)
    parser.add_argument("--only-reduced", action="store_true")
    parser.add_argument("--output", type=Path, default=Path("output/review/encoding-fidelity-fixes/options.json"))
    arguments = parser.parse_args()
    if arguments.only_reduced and not arguments.photos_root:
        parser.error("--only-reduced requires --photos-root")
    if arguments.instrument_avif:
        instrument_avif(arguments.instrument_avif)
    else:
        probe(arguments)
