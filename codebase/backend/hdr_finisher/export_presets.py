"""Batch configuration and safe exported-file naming. Originals are never renamed."""
from copy import deepcopy
from datetime import datetime
import json
import os
from pathlib import Path
import re
from threading import RLock
from uuid import uuid4
from pydantic import BaseModel, Field
from .models import ExportSettings

SUFFIXES = {"avif_gain_map": ".avif", "jpeg_ultrahdr": ".jpg", "jpegxl_hdr": ".jxl", "sdr_jpegxl": ".jxl", "sdr_png": ".png", "sdr_jpeg": ".jpg"}

class ExportVersion(BaseModel):
    name: str = Field(default="Version 1", min_length=1, max_length=120)
    pattern: str = Field(default="{filename}_{version}", min_length=1, max_length=300)
    subfolder: str = Field(default="", max_length=300)
    quality_preset: str = "web_default"
    reference_white: int | None = None
    settings: ExportSettings = Field(default_factory=ExportSettings)

class ExportPreset(BaseModel):
    id: str = Field(default_factory=lambda: uuid4().hex, pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    name: str = Field(min_length=1, max_length=120)
    versions: list[ExportVersion] = Field(min_length=1, max_length=32)

def safe_component(value):
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(value)).strip().rstrip(". ") or "untitled"
    if re.match(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", value, re.I): value = "_" + value
    return value[:180]

def render_pattern(pattern, photo, sequence, version, preset):
    try: date = datetime.fromisoformat(str(photo.get("capture_time", "")).replace("Z", "+00:00"))
    except ValueError: date = None
    values = {"filename": Path(photo["source_path"]).stem, "copy": photo.get("copy_name", ""), "sequence": str(sequence),
              "date": date.strftime("%Y-%m-%d") if date else "undated", "rating": str(photo.get("rating", 0)), "version": version, "preset": preset}
    def replace(match):
        token = match[1]
        if token.startswith("sequence:"):
            padding = token.split(":", 1)[1]
            if not padding.isdigit() or not 1 <= int(padding) <= 12: raise ValueError("Sequence padding must be 1 to 12.")
            return str(sequence).zfill(int(padding))
        if token.startswith("date:"):
            fmt = token[5:]
            if fmt not in {"YYYY-MM-DD", "YYYYMMDD", "YYYY", "YYYY-MM", "DD-MM-YYYY"}: raise ValueError("Unknown capture date format.")
            return date.strftime({"YYYY-MM-DD":"%Y-%m-%d","YYYYMMDD":"%Y%m%d","YYYY":"%Y","YYYY-MM":"%Y-%m","DD-MM-YYYY":"%d-%m-%Y"}[fmt]) if date else "undated"
        if token not in values: raise ValueError(f"Unknown filename token: {token}")
        return values[token]
    return safe_component(re.sub(r"\{([^{}]+)\}", replace, pattern))

def version_destination(directory, version, photo, sequence, preset):
    root = Path(directory).resolve()
    parts = version.subfolder.replace("\\", "/").split("/")
    if any(part in {".", ".."} for part in parts) or Path(version.subfolder).is_absolute(): raise ValueError("Use a relative sub-folder without dots.")
    folder = root.joinpath(*(safe_component(part) for part in parts if part))
    folder.mkdir(parents=True, exist_ok=True)
    if not folder.resolve().is_relative_to(root): raise ValueError("The sub-folder is outside the destination.")
    return folder / (render_pattern(version.pattern, photo, sequence, version.name, preset) + SUFFIXES[version.settings.format])

class ExportPresets:
    def __init__(self, root): self.root, self.lock = Path(root), RLock()
    def list(self):
        with self.lock:
            return [ExportPreset.model_validate_json(p.read_text(encoding="utf-8")) for p in sorted(self.root.glob("*.json"))]
    def save(self, preset):
        for v in preset.versions:
            if v.settings.format not in SUFFIXES: raise ValueError("Unsupported export format.")
            if v.reference_white not in {None, 100, 203}: raise ValueError("Reference white must be 100 or 203 nits.")
            render_pattern(v.pattern, {"source_path":"example.raw"}, 1, v.name, preset.name)
            if any(p in {".", ".."} for p in v.subfolder.replace("\\", "/").split("/")) or Path(v.subfolder).is_absolute(): raise ValueError("Use a relative sub-folder.")
        with self.lock:
            self.root.mkdir(parents=True, exist_ok=True)
            target = self.root / (preset.id + ".json")
            temporary = target.with_suffix(".tmp")
            temporary.write_text(preset.model_dump_json(indent=2), encoding="utf-8")
            os.replace(temporary, target)
        return preset
    def delete(self, identity):
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", identity): raise ValueError("Invalid preset.")
        with self.lock: (self.root / (identity + ".json")).unlink(missing_ok=True)
