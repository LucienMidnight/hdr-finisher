from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any

from .binaries import resolve_binary


class AVIFInfoError(RuntimeError):
    """Raised when avifdec cannot inspect an AVIF file."""


def inspect_avif(path: Path) -> dict[str, Any]:
    avifdec = resolve_binary("avifdec")
    if avifdec is None:
        raise AVIFInfoError("avifdec is required for AVIF metadata inspection.")

    result = subprocess.run([str(avifdec), "--info", str(path)], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or f"avifdec failed with exit code {result.returncode}."
        raise AVIFInfoError(detail)
    return parse_avifdec_info(result.stdout)


def parse_avifdec_info(output: str) -> dict[str, Any]:
    info: dict[str, Any] = {
        "gain_map_present": False,
        "gain_map": None,
        "alternate_image": {},
        "raw": output,
    }
    section = "primary"

    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line.startswith("*"):
            continue
        if line.startswith("* Alternate image:"):
            section = "alternate"
            continue

        key, value = _split_info_line(line)
        if key is None:
            continue

        if key == "Gain map":
            info["gain_map_present"] = value != "Absent"
            info["gain_map"] = None if value == "Absent" else _parse_gain_map(value)
            continue

        target = info["alternate_image"] if section == "alternate" else info
        normalized_key = _normalize_key(key)
        target[normalized_key] = _coerce_value(value)

    return info


def _split_info_line(line: str) -> tuple[str | None, str | None]:
    match = re.match(r"^\*\s*([^:]+?)\s*:\s*(.*)$", line)
    if not match:
        return None, None
    return match.group(1).strip(), match.group(2).strip()


def _parse_gain_map(value: str) -> dict[str, Any]:
    data: dict[str, Any] = {"description": value}
    resolution = re.search(r"(\d+)x(\d+)\s+pixels", value)
    if resolution:
        data["width"] = int(resolution.group(1))
        data["height"] = int(resolution.group(2))

    bit_depth = re.search(r"(\d+)\s+bit", value)
    if bit_depth:
        data["bit_depth"] = int(bit_depth.group(1))

    matrix = re.search(r"Matrix Coeffs\.\s*(\d+)", value)
    if matrix:
        data["matrix_coefficients"] = int(matrix.group(1))

    base = re.search(r"Base Headroom\s+([0-9.]+)\s+\(([^)]+)\)", value)
    if base:
        data["base_headroom"] = float(base.group(1))
        data["base_headroom_label"] = base.group(2)

    alternate = re.search(r"Alternate Headroom\s+([0-9.]+)\s+\(([^)]+)\)", value)
    if alternate:
        data["alternate_headroom"] = float(alternate.group(1))
        data["alternate_headroom_label"] = alternate.group(2)

    return data


def _normalize_key(value: str) -> str:
    return (
        value.lower()
        .replace(".", "")
        .replace(" ", "_")
        .replace("__", "_")
    )


def _coerce_value(value: str | None) -> Any:
    if value is None:
        return None
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    if re.fullmatch(r"-?\d+\.\d+", value):
        return float(value)
    return value
