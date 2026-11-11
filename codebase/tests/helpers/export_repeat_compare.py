"""Compare complete decoded exports with the existing delivery tolerance."""
from dataclasses import asdict
import json
from pathlib import Path
import sys
from hdr_finisher.loader import load_image
from hdr_finisher.delivery_colour import compare_finished_pixels

first, second = [load_image(Path(p)) for p in sys.argv[1:]]
results = {}
for lane, index in (("hdr", 0), ("sdr", 4)):
    metric = compare_finished_pixels(first[index], second[index], lane)
    results[lane] = dict(asdict(metric), passed=metric.passed)
print(json.dumps(results))
