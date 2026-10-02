"""Compare authoring estimates with the CPU delivery reference; no rendering."""
from __future__ import annotations

import math

EDITING_MEASUREMENT_LIMIT = .01


def measurement_warnings(estimated: dict, exact: dict) -> list[str]:
    warnings = []
    for lane, values in estimated.items():
        measured = exact.get(lane, {})
        for name in ("peak", "anchor"):
            before, after = values.get(name), measured.get(name)
            if before is None or after is None or not math.isfinite(before) or not math.isfinite(after) or after <= 0:
                continue
            difference = abs(before / after - 1)
            if difference > EDITING_MEASUREMENT_LIMIT:
                description = "peak" if name == "peak" else "highlight anchor"
                warnings.append(f"{lane.upper()} editing {description} estimate differs from the exact delivery measurement by {difference*100:.1f}% (limit 1%). The delivered image uses the exact measurement.")
    return warnings
