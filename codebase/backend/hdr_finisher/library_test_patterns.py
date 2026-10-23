"""Create and pin the optional, app-managed Library test-pattern folder."""
from __future__ import annotations

from pathlib import Path


def _write_acescg_exr(path: Path, image) -> None:
    import OpenEXR
    import numpy as np

    pixels = np.asarray(image, dtype=np.float32)
    header = {"type": OpenEXR.scanlineimage, "colorInteropID": "lin_ap1_scene"}
    channels = {name: np.ascontiguousarray(pixels[..., index]) for index, name in enumerate(("R", "G", "B"))}
    OpenEXR.File(header, channels).write(str(path))


def set_test_patterns_enabled(browser, enabled: bool) -> dict[str, object]:
    """Show or hide generated patterns in the Library without deleting files."""
    folder = Path(browser.root) / "Test Patterns"
    pinned = {item["path"] for item in browser.pinned()}
    folder_path = str(folder.resolve())
    changed = False
    if enabled:
        folder.mkdir(parents=True, exist_ok=True)
        from .test_pattern import build_delivery_proof_pattern, build_hdr_test_pattern

        patterns = (
            (folder / "HDR test pattern.exr", build_hdr_test_pattern),
            (folder / "Delivery proof test pattern.exr", build_delivery_proof_pattern),
        )
        for path, build in patterns:
            if not path.exists():
                _write_acescg_exr(path, build())
                changed = True
        if folder_path not in pinned:
            browser.add_pin(folder_path)
            changed = True
    elif folder_path in pinned:
        browser.remove_pin(folder_path)
        changed = True
    return {"enabled": bool(enabled), "folder": folder_path, "pinned": folder_path in {item["path"] for item in browser.pinned()}, "changed": changed}
