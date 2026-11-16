"""Strict per-file own-source JXL fidelity and independent delivery ceiling."""
import json
from pathlib import Path
import sys
from delivery_comparison import compare_delivery, own_fidelity
from hdr_finisher.hdr_delivery import check_decoded_hdr_ceiling
from hdr_finisher.jpegxl import inspect_jpegxl

root = Path(sys.argv[1])
results = {}
for lane in ("HDR", "SDR"):
    results[lane] = compare_delivery(root / f"{lane}-gpu.jxl", root / f"{lane}-cpu.jxl")
    assert all(value["passed"] for value in results[lane]["renderer_agreement"].values())
for file in root.glob("*.jxl"):
    value = own_fidelity(file)
    assert value["required"], value
    info = inspect_jpegxl(file)
    assert info["bits_per_sample"] == (8 if value["format"] == "sdr_jpegxl" else 12)
    if value["format"] == "jpegxl_hdr":
        value["peak_nits"] = check_decoded_hdr_ceiling(file, "jpegxl_hdr", 1000)
    results[file.name] = value
print(json.dumps(results))
