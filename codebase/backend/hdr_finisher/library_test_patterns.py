"""Create and pin the optional, app-managed Library test-pattern folder."""
from __future__ import annotations

from pathlib import Path


def _write_exr(path: Path, image, interop_id: str = "lin_ap1_scene") -> None:
    import OpenEXR
    import numpy as np

    pixels = np.asarray(image, dtype=np.float32)
    header = {"type": OpenEXR.scanlineimage, "colorInteropID": interop_id}
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
        from .test_pattern import build_delivery_proof_pattern, build_hdr_test_pattern, build_hue_exposure_sweep

        patterns = (
            (folder / "HDR test pattern.exr", build_hdr_test_pattern, "lin_ap1_scene"),
            (folder / "Delivery proof test pattern.exr", build_delivery_proof_pattern, "lin_ap1_scene"),
            (folder / "Hue and exposure sweep.exr", build_hue_exposure_sweep, "lin_rec709_scene"),
        )
        for path, build, interop_id in patterns:
            if not path.exists():
                _write_exr(path, build(), interop_id)
                changed = True
        if folder_path not in pinned:
            browser.add_pin(folder_path)
            changed = True
    elif folder_path in pinned:
        browser.remove_pin(folder_path)
        changed = True
    return {"enabled": bool(enabled), "folder": folder_path, "pinned": folder_path in {item["path"] for item in browser.pinned()}, "changed": changed}
