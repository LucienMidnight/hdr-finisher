"""Bounded research captures and codec probes; production settings stay untouched."""
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

import numpy as np

from hdr_finisher import exporters
from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.delivery_colour import compare_finished_pixels
from hdr_finisher.hdr_ceiling import channel_nits, decoded_channel_nits, encode_within_ceiling, ENCODING_ALLOWANCE
from hdr_finisher.jpegxl import encode_hdr_jpegxl, encode_sdr_jpegxl, _pq_oetf
from hdr_finisher.color import acescg_to_linear_bt2020, linear_bt2020_to_acescg
from hdr_finisher.loader import load_image
from hdr_finisher.models import EditDocument, ExportSettings, PreviewKind


def metric(first, second, lane):
    result = compare_finished_pixels(first, second, lane)
    return {**asdict(result), "passed": result.passed}


def prepare(root):
    import tifffile
    from lib.machine_settings import settings
    photos = Path(settings()["photosRoot"]) / "HDR Test Images"
    records = []
    for name in ("DSC08883.avif", "5M071612_finished.avif", "LR-classic-hdr-source-test-1.avif"):
        source = photos / name
        image = load_image(source)[0]
        intensity = image.max(axis=2)
        edge = np.abs(np.diff(intensity, axis=1, prepend=intensity[:, :1]))
        edge += np.abs(np.diff(intensity, axis=0, prepend=intensity[:1]))
        edge[intensity < np.percentile(intensity, 95)] = 0
        center = np.unravel_index(np.argmax(edge), edge.shape)
        top = max(0, min(image.shape[0] - 256, center[0] - 128))
        left = max(0, min(image.shape[1] - 256, center[1] - 128))
        crop = image[top:top + 256, left:left + 256].copy()
        folder = root / Path(name).stem
        folder.mkdir(parents=True, exist_ok=True)
        tifffile.imwrite(folder / "source.tiff", crop, photometric="rgb")
        records.append({"name": name, "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "original_shape": list(image.shape), "crop_xy": [int(left), int(top)], "crop_shape": list(crop.shape),
            "crop_peak_nits": float(channel_nits(crop).max()), "folder": folder.name})
        del image, intensity, edge, crop
    (root / "photos.json").write_text(json.dumps(records, indent=2))


def capture(folder):
    document = EditDocument.model_validate_json((folder / "document.json").read_text())
    source = load_image(folder / "source.tiff", overrides=document.interpretation_override.model_dump())[0]
    finished = json.loads((folder / "finished.json").read_text())
    arrays = {}
    for index, lane in enumerate(("hdr", "sdr")):
        item = finished[index]
        arrays[f"gpu_{lane}"] = np.asarray(item["pixels"], np.float32).reshape(item["height"], item["width"], 4)[..., :3]
        arrays[f"cpu_{lane}"] = apply_adjustments(source, document.global_adjustments, PreviewKind(lane),
            local_adjustments=document.local_adjustments, color_context=RenderColorContext(document.hdr_reference_white_nits))
    np.savez_compressed(folder / "floats.npz", **arrays)
    (folder / "finished.json").unlink()
    (folder / "source.tiff").unlink()


def probe(array_path, destination):
    arrays = np.load(array_path)
    result = {"input_sha256": hashlib.sha256(array_path.read_bytes()).hexdigest(),
        "shape": list(arrays["gpu_hdr"].shape), "pre_encode": {}, "formats": {}}
    for lane in ("hdr", "sdr"):
        result["pre_encode"][lane] = metric(arrays[f"gpu_{lane}"], arrays[f"cpu_{lane}"], lane)
    for format_name in ("avif_gain_map", "jpegxl_hdr"):
        settings = ExportSettings(format=format_name, quality=95, dithering="off")
        records = {"settings": settings.model_dump(mode="json"), "scenarios": {}}
        for delivered in (False, True):
            decoded, metadata, peaks = {}, {}, {}
            with TemporaryDirectory(prefix="hdr-encoding-drift-") as temporary:
                root = Path(temporary)
                for renderer in ("gpu", "cpu", "repeat", "lsb", "native_lsb"):
                    source_renderer = "cpu" if renderer in ("repeat", "lsb", "native_lsb") else renderer
                    hdr = arrays[f"{source_renderer}_hdr"].copy()
                    sdr = arrays[f"{source_renderer}_sdr"].copy()
                    if renderer == "lsb":
                        hdr += np.float32(.18 / 65535)
                        sdr += np.float32(1 / 65535)
                        records["perturbed_input"] = {lane: metric(arrays[f"cpu_{lane}"], value, lane)
                            for lane, value in (("hdr", hdr), ("sdr", sdr))}
                    elif renderer == "native_lsb":
                        import colour
                        hdr_bits, sdr_bits = (10, 10) if format_name == "avif_gain_map" else (12, 8)
                        nits = np.maximum(acescg_to_linear_bt2020(hdr), 0) * np.float32(203 / .18)
                        pq = np.clip(_pq_oetf(nits) + np.float32(1 / ((1 << hdr_bits) - 1)), 0, 1)
                        hdr = linear_bt2020_to_acescg(colour.models.eotf_ST2084(pq).astype(np.float32) * np.float32(.18 / 203))
                        gamma = np.where(sdr <= .0031308, sdr * 12.92, 1.055 * np.maximum(sdr, 0) ** (1 / 2.4) - .055)
                        gamma = np.clip(gamma + np.float32(1 / ((1 << sdr_bits) - 1)), 0, 1)
                        sdr = np.where(gamma <= .04045, gamma / 12.92, ((gamma + .055) / 1.055) ** 2.4)
                        records["native_perturbed_input"] = {"hdr_bits": hdr_bits, "sdr_bits": sdr_bits,
                            **{lane: metric(arrays[f"cpu_{lane}"], value, lane)
                                for lane, value in (("hdr", hdr), ("sdr", sdr))}}
                    path = root / (renderer + (".avif" if format_name == "avif_gain_map" else ".jxl"))
                    def encode(image):
                        if format_name == "avif_gain_map":
                            exporters._write_avif_gainmap_once(path, image, sdr, settings)
                        else:
                            path.write_bytes(encode_hdr_jpegxl(image, settings.quality, settings.jpegxl_precision))
                        return path
                    notes = []
                    try:
                        encode_within_ceiling(hdr, 203, encode,
                            lambda written: decoded_channel_nits(written, format_name), 1000 if delivered else None,
                            notes, encoding_allowance=ENCODING_ALLOWANCE)
                        loaded = load_image(path)
                        decoded[renderer] = {"hdr": loaded[0]}
                        if format_name == "avif_gain_map":
                            decoded[renderer]["sdr"] = loaded[4]
                            metadata[renderer] = loaded[2].get("gain_map_metadata")
                        else:
                            import imagecodecs
                            sdr_path = root / (renderer + "-sdr.jxl")
                            sdr_path.write_bytes(encode_sdr_jpegxl(sdr, settings.quality, dithering="off"))
                            samples = imagecodecs.jpegxl_decode(sdr_path.read_bytes()).astype(np.float32) / 255
                            decoded[renderer]["sdr"] = np.where(samples <= .04045, samples / 12.92, ((samples + .055) / 1.055) ** 2.4)
                        peaks[renderer] = {"nits": float(channel_nits(loaded[0]).max()), "notes": notes,
                            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                    except Exception as error:
                        records.setdefault("errors", []).append({"delivered": delivered, "renderer": renderer,
                            "error": f"{type(error).__name__}: {error}"})
                comparison = {"peaks": peaks, "metadata": metadata}
                for lane in ("hdr", "sdr"):
                    if len(decoded) == 5:
                        comparison[lane] = {"gpu_cpu": metric(decoded["gpu"][lane], decoded["cpu"][lane], lane),
                            "repeat": metric(decoded["cpu"][lane], decoded["repeat"][lane], lane),
                            "lsb": metric(decoded["cpu"][lane], decoded["lsb"][lane], lane),
                            "native_lsb": metric(decoded["cpu"][lane], decoded["native_lsb"][lane], lane),
                            "gpu_fidelity": metric(arrays[f"gpu_{lane}"], decoded["gpu"][lane], lane),
                            "cpu_fidelity": metric(arrays[f"cpu_{lane}"], decoded["cpu"][lane], lane)}
                records["scenarios"]["delivered" if delivered else "initial"] = comparison
        result["formats"][format_name] = records
    destination.write_text(json.dumps(result, indent=2))
    print(destination, flush=True)


if __name__ == "__main__":
    command = sys.argv[1]
    if command == "prepare":
        prepare(Path(sys.argv[2]))
    elif command == "capture":
        capture(Path(sys.argv[2]))
    elif command == "probe":
        probe(Path(sys.argv[2]), Path(sys.argv[3]))
