"""Reference half of the preview-versus-export comparison (Viewport PRD 4.6).

``tests/performance/preview-export-compare.js`` captures the interactive
preview at 100% for one or more visible regions and hands them here. This side
renders the same edit document through the export pipeline, before encoding,
and reports the PRD section 4.1 to 4.3 statistics for the same pixels.

What is compared
  * Export side: ``_render_export_branch`` at full resolution, the frame the
    encoders are handed. Codec error is deliberately outside this comparison.
  * Preview side: the retained presentation target read back as float.

Common space
  Both sides are brought to *display-linear light as the preview presents it*,
  with 1.0 at reference white. The export frame goes through the shader's own
  matrix constants (``export_parity_check``); the readback has its transfer
  curve removed. Luminance is CIE Y of that linear light and colour difference
  is Euclidean distance in OKLab of it.

Luminance near black (owner delegated this choice on October 1, 2026)
  A percentage of nothing is undefined, so the relative luminance error uses a
  floor: ``|Yp - Ye| / max(Ye, FLOOR)`` with ``FLOOR`` at 1% of reference white
  (about 2 nits at a 203-nit white). Above the floor the limits are the plain
  percentages. Below it the same percentages apply to the floor, an absolute
  bound of 0.02% / 0.05% of reference white, and the OKLab limit, which is
  perceptually uniform down to black, carries the judgement of visible
  difference in shadows.

The project and source are only read. The captured edit document is written to
a new archive beside the report.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import json
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from export_parity_check import (  # noqa: E402
    SHADER_ACESCG_TO_BT2020,
    SHADER_ACESCG_TO_SRGB,
    SHADER_BT2020_TO_P3,
    TRANSPORT_CEILING_NITS,
    display_encode,
)
from reference_session import isolate_source_cache, open_reference_session, write_project_archive  # noqa: E402

# PRD section 4, approved by the owner on October 1, 2026.
LIMITS = {
    "luminanceTypical": 0.02,
    "luminanceCeiling": 0.05,
    "oklabTypical": 0.01,
    "oklabCeiling": 0.03,
    "softMaskLevels": 2,
    # Working limit for gradual masks, on trial (owner, October 1, 2026): judged
    # by what a person can perceive at 100%, until he has looked at it on
    # screen. Three levels is about 1.2% of the adjustment's strength. A mask
    # between the approved limit and this one passes and is listed.
    "softMaskWorkingLevels": 3,
    "hardEdgePixels": 1,
    "maskMovePixels": 2,
    "editingPeak": 0.01,
}
TYPICAL_PERCENTILE = 99.0
LUMINANCE_FLOOR_OF_WHITE = 0.01
# PRD 4.1, 8-bit presentation targets: a difference of at most this many levels
# of the preview's display encoding does not count against the tone limits.
EIGHT_BIT_EXEMPT_LEVELS = 1.0
CANVAS_WHITE_NITS = 203.0
EDGE_SEARCH_PIXELS = 8

SRGB_TO_XYZ = np.array(
    [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]]
)
P3_TO_XYZ = np.array(
    [[0.4865709, 0.2656677, 0.1982173], [0.2289746, 0.6917385, 0.0792869], [0.0, 0.0451134, 1.0439444]]
)
XYZ_TO_LMS = np.array(
    [[0.8189330101, 0.3618667424, -0.1288597137], [0.0329845436, 0.9293118715, 0.0361456387],
     [0.0482003018, 0.2643662691, 0.6338517070]]
)
LMS_TO_OKLAB = np.array(
    [[0.2104542553, 0.7936177850, -0.0040720468], [1.9779984951, -2.4285922050, 0.4505937099],
     [0.0259040371, 0.7827717662, -0.8086757660]]
)
BT2020_LUMA = np.array([0.2627, 0.6780, 0.0593])


def srgb_decode(encoded: np.ndarray) -> np.ndarray:
    """Inverse of the preview's displayEncodeChannel, sign-preserving."""
    magnitude = np.abs(encoded)
    linear = np.where(magnitude <= 0.04045, magnitude / 12.92, np.power((magnitude + 0.055) / 1.055, 2.4))
    return np.sign(encoded) * linear


def export_to_presentation_linear(
    render: np.ndarray, *, lane: str, hdr_surface: bool, reference_white_nits: float
) -> np.ndarray:
    """The export frame as linear display light, through the preview's own transform."""
    rgb = np.asarray(render, dtype=np.float64)[..., :3]
    if lane == "sdr":
        return np.clip(rgb, 0.0, 1.0)
    if hdr_surface:
        bt2020 = rgb @ SHADER_ACESCG_TO_BT2020.T
        ceiling = TRANSPORT_CEILING_NITS * 0.18 / reference_white_nits
        bt2020 = np.clip(bt2020, 0.0, ceiling)
        return (bt2020 @ SHADER_BT2020_TO_P3.T) / 0.18 * (reference_white_nits / CANVAS_WHITE_NITS)
    display = np.maximum(rgb @ SHADER_ACESCG_TO_SRGB.T, 0.0)
    return display / (1.0 + display)


def presentation_space(lane: str, hdr_surface: bool, reference_white_nits: float) -> dict[str, Any]:
    if lane == "hdr" and hdr_surface:
        return {
            "name": "linear Display P3, extended, 1.0 = 203 nits",
            "toXyz": P3_TO_XYZ,
            "white": reference_white_nits / CANVAS_WHITE_NITS,
            "hdrPrecision": True,
        }
    if lane == "hdr":
        return {
            "name": "linear sRGB after the SDR-surface roll-off (no HDR precision claim)",
            "toXyz": SRGB_TO_XYZ,
            "white": 1.0,
            "hdrPrecision": False,
        }
    return {"name": "linear sRGB, 1.0 = SDR white", "toXyz": SRGB_TO_XYZ, "white": 1.0, "hdrPrecision": False}


def oklab(linear_rgb: np.ndarray, to_xyz: np.ndarray, white: float) -> np.ndarray:
    xyz = (linear_rgb / white) @ to_xyz.T
    lms = xyz @ XYZ_TO_LMS.T
    return np.cbrt(lms) @ LMS_TO_OKLAB.T


def _percentile(values: np.ndarray, amount: float) -> float:
    return float(np.percentile(values, amount)) if values.size else 0.0


def target_is_eight_bit(target_format: str) -> bool:
    """Whether the preview's presentation target is an 8-bit one (PRD 4.1).

    Only a format that names itself 8-bit qualifies; anything else, including a
    format this tool does not know, is judged by the limits as written.
    """
    return "8unorm" in str(target_format)


def _bound(values: np.ndarray, judged: np.ndarray, typical_limit: float, ceiling_limit: float) -> dict[str, Any]:
    """One section 4.1 quantity: what was measured, and what counts against the limits."""
    pixels = max(1, int(values.size))
    typical = _percentile(judged, TYPICAL_PERCENTILE)
    ceiling = float(judged.max(initial=0.0))
    worst = np.unravel_index(int(np.argmax(values)), values.shape)
    worst_judged = np.unravel_index(int(np.argmax(judged)), judged.shape)
    return {
        "median": round(_percentile(values, 50.0), 6),
        "p99": round(_percentile(values, TYPICAL_PERCENTILE), 6),
        "max": round(float(values.max(initial=0.0)), 6),
        "worstPixel": {"x": int(worst[1]), "y": int(worst[0])},
        "judged": {
            "p99": round(typical, 6),
            "max": round(ceiling, 6),
            "worstPixel": {"x": int(worst_judged[1]), "y": int(worst_judged[0])},
        },
        "fractionAboveTypical": round(float(np.count_nonzero(judged > typical_limit)) / pixels, 8),
        "countAboveCeiling": int(np.count_nonzero(judged > ceiling_limit)),
        "typicalOk": typical <= typical_limit,
        "ceilingOk": ceiling <= ceiling_limit,
    }


def tone_statistics(
    preview: np.ndarray, export: np.ndarray, space: dict[str, Any], *, eight_bit_target: bool = False
) -> dict[str, Any]:
    """Section 4.1: luminance and OKLab agreement, typical bound and ceiling.

    ``median``, ``p99``, ``max`` and the outer ``worstPixel`` are what was
    measured. ``judged`` and the verdicts are what counts against the limits.
    The two differ only on an 8-bit target, where a pixel whose largest channel
    difference from the export is at most one level of the preview's display
    encoding is exempt (owner decision, October 1, 2026): it stays in the
    population as a pixel inside the limits. A pixel more than one level away
    is judged by the limits as written.
    """
    to_xyz = space["toXyz"]
    white = float(space["white"])
    luminance_preview = preview @ to_xyz[1]
    luminance_export = export @ to_xyz[1]
    floor = LUMINANCE_FLOOR_OF_WHITE * white
    relative = np.abs(luminance_preview - luminance_export) / np.maximum(luminance_export, floor)
    delta = np.linalg.norm(oklab(preview, to_xyz, white) - oklab(export, to_xyz, white), axis=-1)
    pixels = int(relative.size)
    # The difference in the preview's own encoding, in 8-bit levels. An 8-bit
    # presentation target cannot represent less than one level, which near
    # black is several percent of luminance.
    levels = np.max(np.abs(display_encode(preview) - display_encode(export)), axis=-1) * 255.0
    exempt = (levels <= EIGHT_BIT_EXEMPT_LEVELS) if eight_bit_target else np.zeros(levels.shape, dtype=bool)
    luminance = _bound(relative, np.where(exempt, 0.0, relative), LIMITS["luminanceTypical"], LIMITS["luminanceCeiling"])
    colour = _bound(delta, np.where(exempt, 0.0, delta), LIMITS["oklabTypical"], LIMITS["oklabCeiling"])
    for worst in (luminance["worstPixel"], luminance["judged"]["worstPixel"]):
        at = (worst["y"], worst["x"])
        worst["preview"] = float(luminance_preview[at])
        worst["export"] = float(luminance_export[at])
        worst["levels"] = round(float(levels[at]), 4)
    return {
        "pixels": pixels,
        "belowFloorFraction": round(float(np.count_nonzero(luminance_export < floor)) / max(1, pixels), 6),
        "eightBitRule": {
            "applied": bool(eight_bit_target),
            "exemptLevels": EIGHT_BIT_EXEMPT_LEVELS,
            "exemptPixels": int(np.count_nonzero(exempt)),
            "exemptFraction": round(float(np.count_nonzero(exempt)) / max(1, pixels), 8),
            # Pixels the rule kept from counting: outside a limit, yet within one level.
            "exemptOverLuminanceTypical": int(np.count_nonzero(exempt & (relative > LIMITS["luminanceTypical"]))),
            "exemptOverLuminanceCeiling": int(np.count_nonzero(exempt & (relative > LIMITS["luminanceCeiling"]))),
            "exemptOverOklabTypical": int(np.count_nonzero(exempt & (delta > LIMITS["oklabTypical"]))),
            "exemptOverOklabCeiling": int(np.count_nonzero(exempt & (delta > LIMITS["oklabCeiling"]))),
        },
        "encodedLevels": {
            "unit": "largest channel difference in the preview's display encoding, in 1/255 steps",
            "p99": round(_percentile(levels, TYPICAL_PERCENTILE), 4),
            "max": round(float(levels.max(initial=0.0)), 4),
            "fractionAboveOneLevel": round(float(np.count_nonzero(levels > 1.0)) / max(1, pixels), 8),
        },
        "luminance": {"unit": "relative error against the export, floored at 1% of reference white", **luminance},
        "oklab": {"unit": "Euclidean distance in OKLab, reference white at L = 1", **colour},
        "_relative": relative,
        "_delta": delta,
    }


def _edges(inside: np.ndarray) -> np.ndarray:
    """Pixels of a binary region that touch the outside (4-connected)."""
    edge = np.zeros_like(inside)
    edge[1:, :] |= inside[1:, :] != inside[:-1, :]
    edge[:-1, :] |= inside[1:, :] != inside[:-1, :]
    edge[:, 1:] |= inside[:, 1:] != inside[:, :-1]
    edge[:, :-1] |= inside[:, 1:] != inside[:, :-1]
    return edge & inside


def _dilate(mask: np.ndarray) -> np.ndarray:
    """One step of 8-connected dilation, so distance is counted in whole pixels."""
    grown = mask.copy()
    grown[1:, :] |= mask[:-1, :]
    grown[:-1, :] |= mask[1:, :]
    grown[:, 1:] |= grown[:, :-1].copy()
    grown[:, :-1] |= grown[:, 1:].copy()
    return grown


def edge_displacement(preview: np.ndarray, export: np.ndarray) -> dict[str, Any]:
    """How far the 50% contour of one mask sits from the other, in pixels."""
    # 127.5 is where an unrounded value rounds to 128, the 8-bit mask's half.
    preview_inside = preview >= 127.5
    export_inside = export >= 127.5
    preview_edge = _edges(preview_inside)
    export_edge = _edges(export_inside)
    if not export_edge.any() and not preview_edge.any():
        return {"edgePixels": 0, "maxPixels": 0, "p99Pixels": 0, "note": "no 50% contour inside the region"}
    if export_edge.any() != preview_edge.any():
        return {"edgePixels": int(export_edge.sum() + preview_edge.sum()), "maxPixels": None, "p99Pixels": None,
                "note": "a 50% contour is present on one side only"}

    def one_way(source: np.ndarray, target: np.ndarray) -> np.ndarray:
        distance = np.full(source.shape, EDGE_SEARCH_PIXELS + 1, dtype=np.int32)
        reached = target.copy()
        for step in range(EDGE_SEARCH_PIXELS + 1):
            newly = source & reached & (distance > step)
            distance[newly] = step
            reached = _dilate(reached)
        return distance[source]

    distances = np.concatenate([one_way(export_edge, preview_edge), one_way(preview_edge, export_edge)])
    return {
        "edgePixels": int(distances.size),
        "maxPixels": int(distances.max()),
        "p99Pixels": float(np.percentile(distances, 99.0)),
        "searchLimitPixels": EDGE_SEARCH_PIXELS,
    }


def mask_statistics(preview: np.ndarray, export: np.ndarray) -> dict[str, Any]:
    """Section 4.2: mask value agreement and placement of the 50% contour.

    Both masks are in 255ths. The export's is 8-bit. The preview's may be
    unrounded (a renderer readback); it is compared as it is, so rounding in
    the export can add up to half a level to the difference and never hides
    any. A mask is present where it would round to at least one level.
    """
    preview = np.asarray(preview, dtype=np.float32)
    export = np.asarray(export, dtype=np.float32)
    difference = np.abs(preview - export)
    preview_present = bool((preview >= 0.5).any())
    export_present = bool((export >= 0.5).any())
    displacement = edge_displacement(preview, export)
    maximum = round(float(difference.max(initial=0.0)), 3)
    moved = displacement["maxPixels"]
    return {
        "pixels": int(difference.size),
        "maxLevels": maximum,
        "p99Levels": round(_percentile(difference, TYPICAL_PERCENTILE), 3),
        "pixelsAboveSoftLimit": int(np.count_nonzero(difference > LIMITS["softMaskLevels"])),
        "differingPixels": int(np.count_nonzero(difference > 0.5)),
        "presentInPreview": preview_present,
        "presentInExport": export_present,
        "edge": displacement,
        "pixelsAboveWorkingLimit": int(np.count_nonzero(difference > LIMITS["softMaskWorkingLevels"])),
        "softOk": maximum <= LIMITS["softMaskWorkingLevels"],
        "overApprovedSoftLimit": maximum > LIMITS["softMaskLevels"],
        "hardEdgeOk": moved is not None and moved <= LIMITS["hardEdgePixels"],
        # A gradual mask is judged by its values: a difference too small to see
        # moves its halfway line a long way where the mask is nearly flat. The
        # placement check is for an edge (owner, October 1, 2026).
        "regionOk": preview_present == export_present and (
            maximum <= LIMITS["softMaskWorkingLevels"]
            or (moved is not None and moved <= LIMITS["maskMovePixels"])
        ),
    }


def peak_statistics(render: np.ndarray, capture: dict[str, Any], adjustments: Any, reference_white: float) -> dict[str, Any]:
    """Section 4.3: reported peak against the export's exact peak, and the delivered ceiling."""
    from hdr_finisher.color import acescg_to_linear_bt2020
    from hdr_finisher.color_context import scene_linear_to_nits

    bt2020 = np.clip(acescg_to_linear_bt2020(np.asarray(render, dtype=np.float32)[..., :3]), 0.0, None)
    luma = scene_linear_to_nits(bt2020 @ BT2020_LUMA.astype(np.float32), int(reference_white))
    luma_nits = float(np.max(luma, initial=0.0))
    channel_nits = float(np.max(scene_linear_to_nits(bt2020, int(reference_white)), initial=0.0))
    peak_y, peak_x = np.unravel_index(int(np.argmax(luma)), luma.shape)
    reported = capture.get("peak") or {}
    reported_nits = reported.get("reportedNits")
    result: dict[str, Any] = {
        "export": {
            "lumaPeakNits": round(luma_nits, 4),
            "channelPeakNits": round(channel_nits, 4),
            "measuredAt": [int(render.shape[1]), int(render.shape[0])],
            "lumaPeakPixel": {"x": int(peak_x), "y": int(peak_y),
                              "fractionX": round(float(peak_x) / render.shape[1], 5),
                              "fractionY": round(float(peak_y) / render.shape[0], 5)},
            "pixelsWithin1PercentOfPeak": int(np.count_nonzero(luma >= luma_nits * 0.99)),
            "p9999Nits": round(float(np.percentile(luma, 99.99)), 4),
            "note": "maximum over the full export frame before encoding",
        },
        "preview": reported,
    }
    if isinstance(reported_nits, (int, float)):
        # The app's reported peak is compared with both definitions because
        # this tool does not assume which one the scope implements.
        result["relativeToLumaPeak"] = round(abs(reported_nits - luma_nits) / max(luma_nits, 1e-9), 6)
        result["relativeToChannelPeak"] = round(abs(reported_nits - channel_nits) / max(channel_nits, 1e-9), 6)
        result["editingLimit"] = LIMITS["editingPeak"]
        result["withinEditingLimit"] = min(result["relativeToLumaPeak"], result["relativeToChannelPeak"]) <= LIMITS["editingPeak"]
    hdr = adjustments.hdr
    active = bool(hdr.highlight_section_enabled) and hdr.highlight_compression_mode != "off"
    target = float(hdr.highlight_compression_target_nits)
    result["delivered"] = {
        "compressionActive": active,
        "mode": hdr.highlight_compression_mode,
        "targetNits": target,
        "lumaPeakOverTargetNits": round(luma_nits - target, 4) if active else None,
        "channelPeakOverTargetNits": round(channel_nits - target, 4) if active else None,
        "lumaWithinTarget": (luma_nits <= target) if active else None,
        "channelWithinTarget": (channel_nits <= target) if active else None,
    }
    return result


def _write_png(path: Path, image: np.ndarray) -> None:
    from PIL import Image

    Image.fromarray(np.round(np.clip(image, 0.0, 1.0) * 255.0).astype(np.uint8)).save(path, format="PNG")


def _review_images(directory: Path, stem: str, preview: np.ndarray, export: np.ndarray, statistics: dict[str, Any], white: float) -> dict[str, str]:
    """8-bit pictures for a human to look at. No number rests on them."""
    directory.mkdir(parents=True, exist_ok=True)

    def encode(linear: np.ndarray) -> np.ndarray:
        clipped = np.clip(linear / white, 0.0, 1.0)
        return np.where(clipped <= 0.0031308, clipped * 12.92, 1.055 * np.power(clipped, 1.0 / 2.4) - 0.055)

    files = {
        "preview": directory / f"{stem}-preview.png",
        "export": directory / f"{stem}-export.png",
        "luminanceError": directory / f"{stem}-luminance-error.png",
    }
    _write_png(files["preview"], encode(preview))
    _write_png(files["export"], encode(export))
    # White is the 5% ceiling; mid grey is the 2% typical bound.
    error = np.clip(statistics["_relative"] / LIMITS["luminanceCeiling"], 0.0, 1.0)
    _write_png(files["luminanceError"], np.repeat(error[..., None], 3, axis=-1))
    return {name: str(path) for name, path in files.items()}


@contextmanager
def inspect_sdr_stages(regions: list[dict[str, Any]]):
    """Read CPU stage coverage for a diagnostic export render, without changing pixels."""
    from hdr_finisher import adjustments, local_adjustments
    from hdr_finisher.models import PreviewKind

    evidence: dict[str, Any] = {"globalDetail": [], "locals": []}
    original_detail = adjustments.apply_detail
    original_locals = local_adjustments.apply_local_stack

    def samples(image, region):
        x, y, width, height = (int(region["rect"][key]) for key in ("x", "y", "width", "height"))
        return image[y:y + height, x:x + width, :3]

    def detail(image, recipe, kind, **kwargs):
        result = original_detail(image, recipe, kind, **kwargs)
        if kind == PreviewKind.SDR:
            for region in regions:
                before, after = samples(image, region), samples(result, region)
                bright = np.max(before, axis=-1) > 1.0
                unchanged = np.all(before == after, axis=-1)
                evidence["globalDetail"].append({
                    "id": region["id"], "inputAboveWhitePixels": int(np.count_nonzero(bright)),
                    "inputMaxChannel": float(np.max(before)),
                    "aboveWhiteUnchangedPixels": int(np.count_nonzero(bright & unchanged)),
                    "aboveWhiteChangedAndClippedPixels": int(np.count_nonzero(
                        bright & ~unchanged & (np.max(after, axis=-1) <= 1.0))),
                })
        return result

    def locals_(image, fixed_source, locals, kind, geometry, **kwargs):
        # Keep only the captured regions, never an extra whole native frame.
        before = [samples(image, region).copy() for region in regions] if kind == PreviewKind.SDR else []
        result = original_locals(image, fixed_source, locals, kind, geometry, **kwargs)
        for region, source in zip(regions, before):
            bright = np.max(source, axis=-1) > 1.0
            recovered = np.max(samples(result, region), axis=-1) < 0.98
            evidence["locals"].append({
                "id": region["id"], "inputAboveWhitePixels": int(np.count_nonzero(bright)),
                "recoveredBelow098Pixels": int(np.count_nonzero(bright & recovered)),
            })
        return result

    adjustments.apply_detail, local_adjustments.apply_local_stack = detail, locals_
    try:
        yield evidence
    finally:
        adjustments.apply_detail, local_adjustments.apply_local_stack = original_detail, original_locals


def run(manifest_path: Path, output_path: Path) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    work = manifest_path.parent
    isolate_source_cache(work / "source-cache")

    from hdr_finisher.exporters import _finishing_adjustments_for_export, _render_export_branch
    from hdr_finisher.local_adjustments import compile_geometry_fixed_mask
    from hdr_finisher.models import ExportSettings, PreviewKind

    project_copy = work / f"{manifest_path.stem}-document.hdrfinisher"
    project_copy.unlink(missing_ok=True)
    write_project_archive(manifest["document"], project_copy)
    started = time.perf_counter()
    _store, session = open_reference_session(project_copy)
    open_seconds = time.perf_counter() - started
    reference_white = float(session.hdr_reference_white_nits)
    finishing = _finishing_adjustments_for_export(session)
    settings = ExportSettings()

    report: dict[str, Any] = {
        "project": manifest.get("project"),
        "source": str(session.source_path),
        "sourceSize": [int(session.image.shape[1]), int(session.image.shape[0])],
        "limits": LIMITS,
        "typicalPercentile": TYPICAL_PERCENTILE,
        "luminanceFloorOfWhite": LUMINANCE_FLOOR_OF_WHITE,
        "eightBitExemptLevels": EIGHT_BIT_EXEMPT_LEVELS,
        "exportSide": "_render_export_branch at full resolution, before encoding, output finishing neutral",
        "referenceOpenSeconds": round(open_seconds, 2),
        "lanes": [],
    }
    masks: dict[str, np.ndarray] = {}

    def compare_masks(captures: list[dict[str, Any]], x: int, y: int, width: int, height: int) -> list[dict[str, Any]]:
        """Each captured preview mask against the export's mask for the same pixels."""
        entries = []
        for mask_capture in captures:
            local = next((item for item in session.local_adjustments if item.id == mask_capture["localId"]), None)
            entry: dict[str, Any] = {
                "localId": mask_capture["localId"],
                "name": mask_capture.get("name"),
                "leafType": mask_capture.get("leafType"),
                "route": mask_capture.get("route"),
                "previewSource": mask_capture.get("previewSource"),
            }
            entries.append(entry)
            if local is None or not mask_capture.get("file"):
                entry["measured"] = False
                entry["reason"] = mask_capture.get("reason") or "no preview-side mask was captured"
                continue
            if local.id not in masks:
                masks[local.id] = compile_geometry_fixed_mask(
                    session.image, local.mask, session.adjustments.shared.geometry, spatial_only=True
                )
            export_mask = masks[local.id][y:y + height, x:x + width]
            preview_mask = np.fromfile(work / mask_capture["file"], dtype="<f4") * np.float32(255.0)
            if preview_mask.size != width * height or export_mask.shape != (height, width):
                entry["measured"] = False
                entry["reason"] = (
                    f"mask sizes differ: preview {preview_mask.size} values for a {width}x{height} region, "
                    f"export {export_mask.shape[1]}x{export_mask.shape[0]}"
                )
                continue
            if not np.isfinite(preview_mask).all():
                entry["measured"] = False
                entry["reason"] = "the readback left pixels of the region unfilled"
                continue
            entry["measured"] = True
            entry.update(mask_statistics(preview_mask.reshape(height, width), export_mask))
        return entries

    for lane_capture in manifest["lanes"]:
        lane = lane_capture["lane"]
        kind = PreviewKind.HDR if lane == "hdr" else PreviewKind.SDR
        started = time.perf_counter()
        stage_evidence = None
        if lane == "sdr" and manifest.get("inspectSdrStages"):
            with inspect_sdr_stages(lane_capture["regions"]) as stage_evidence:
                render = _render_export_branch(session, settings, kind, finishing)
        else:
            render = _render_export_branch(session, settings, kind, finishing)
        render_seconds = time.perf_counter() - started
        hdr_surface = bool(lane_capture["hdrSurface"])
        space = presentation_space(lane, hdr_surface, reference_white)
        target = lane_capture["target"]
        eight_bit = target_is_eight_bit(target.get("format", ""))
        lane_report: dict[str, Any] = {
            "eightBitTarget": eight_bit,
            "lane": lane,
            "exportRenderSeconds": round(render_seconds, 2),
            "exportSize": [int(render.shape[1]), int(render.shape[0])],
            "previewTarget": target,
            "routeChosenByApp": lane_capture.get("routeChosenByApp"),
            "capturedOn": lane_capture.get("capturedOn"),
            "space": {key: value for key, value in space.items() if key != "toXyz"},
            "sizesAgree": [int(render.shape[1]), int(render.shape[0])] == [int(target["width"]), int(target["height"])],
            "regions": [],
        }
        if stage_evidence is not None:
            lane_report["stageEvidence"] = stage_evidence
        if lane == "hdr":
            lane_report["peak"] = peak_statistics(render, lane_capture, session.adjustments, reference_white)
        if not lane_report["sizesAgree"]:
            lane_report["error"] = "The preview target and the export frame differ in size; pixels cannot be paired."
            report["lanes"].append(lane_report)
            continue
        # The masks of the route the app chose by itself, when the picture had
        # to be captured on another one.
        lane_report["chosenRouteMasks"] = [
            {"id": region["id"], "rect": region["rect"],
             "masks": compare_masks(region.get("masks", []), *(int(region["rect"][key]) for key in ("x", "y", "width", "height")))}
            for region in lane_capture.get("chosenRouteRegions", [])
        ]
        for region in lane_capture["regions"]:
            x, y, width, height = (int(region["rect"][key]) for key in ("x", "y", "width", "height"))
            raw = np.fromfile(work / region["readback"], dtype="<f4")
            if raw.size != width * height * 4:
                raise ValueError(f"{region['id']}: readback has {raw.size} values, expected {width * height * 4}")
            preview_linear = srgb_decode(raw.reshape(height, width, 4)[..., :3].astype(np.float64))
            export_linear = export_to_presentation_linear(
                render[y:y + height, x:x + width], lane=lane, hdr_surface=hdr_surface,
                reference_white_nits=reference_white,
            )
            statistics = tone_statistics(preview_linear, export_linear, space, eight_bit_target=eight_bit)
            files = _review_images(work / "review", f"{lane}-{region['id']}", preview_linear, export_linear,
                                   statistics, float(space["white"]))
            for key in ("luminance", "oklab"):
                for worst in (statistics[key]["worstPixel"], statistics[key]["judged"]["worstPixel"]):
                    worst["imageX"] = worst["x"] + x
                    worst["imageY"] = worst["y"] + y
            region_report: dict[str, Any] = {
                "id": region["id"],
                "rect": region["rect"],
                "tone": {key: value for key, value in statistics.items() if not key.startswith("_")},
                "files": files,
                "masks": [],
            }
            region_report["masks"] = compare_masks(region.get("masks", []), x, y, width, height)
            lane_report["regions"].append(region_report)
            tone = region_report["tone"]
            print(
                f"{lane} {region['id']:<12} {tone['pixels']:>8} px"
                f" | luminance p99 {tone['luminance']['p99'] * 100:.3f}% max {tone['luminance']['max'] * 100:.3f}%"
                f" | OKLab p99 {tone['oklab']['p99']:.5f} max {tone['oklab']['max']:.5f}"
                f" | 8-bit levels p99 {tone['encodedLevels']['p99']:.2f} max {tone['encodedLevels']['max']:.2f}"
                + (
                    f" | judged under the 8-bit rule: luminance p99 {tone['luminance']['judged']['p99'] * 100:.3f}%"
                    f" max {tone['luminance']['judged']['max'] * 100:.3f}%"
                    f", OKLab p99 {tone['oklab']['judged']['p99']:.5f} max {tone['oklab']['judged']['max']:.5f}"
                    f", {tone['eightBitRule']['exemptFraction'] * 100:.2f}% of pixels within one level"
                    if eight_bit else ""
                )
            )
        for region_report in [*lane_report["regions"], *lane_report["chosenRouteMasks"]]:
            for mask in region_report["masks"]:
                print(
                    f"{lane} {region_report['id']:<12} mask {str(mask['leafType']):<16} {str(mask['route']):<7}"
                    + (f" max {mask['maxLevels']:.2f} levels, {mask['pixelsAboveSoftLimit']} px over 2,"
                       f" edge {mask['edge']['maxPixels']} px | {mask['previewSource']}"
                       if mask["measured"] else f" NOT MEASURED: {mask['reason']}")
                )
        report["lanes"].append(lane_report)

    def verdicts() -> dict[str, bool]:
        tone_ok = True
        mask_ok = True
        pairs = True
        peak_ok = True
        for lane_report in report["lanes"]:
            if lane_report.get("peak"):
                peak_ok = peak_ok and lane_report["peak"].get("withinEditingLimit", False)
            pairs = pairs and lane_report["sizesAgree"]
            for region_report in lane_report["regions"]:
                tone = region_report["tone"]
                tone_ok = tone_ok and all(
                    tone[key][name] for key in ("luminance", "oklab") for name in ("typicalOk", "ceilingOk")
                )
            for region_report in [*lane_report["regions"], *lane_report.get("chosenRouteMasks", [])]:
                for mask in region_report["masks"]:
                    # A mask that could not be read back is a failure, not a pass.
                    mask_ok = mask_ok and bool(mask.get("measured")) and mask["regionOk"] and (
                        mask["softOk"] or mask["hardEdgeOk"]
                    )
        return {"pixelsPaired": pairs, "tone": tone_ok, "masks": mask_ok, "peak": peak_ok}

    # Masks that pass only under the working limit, for the owner to look at.
    report["masksOverApprovedSoftLimit"] = [
        {"lane": lane_report["lane"], "region": region_report["id"], "name": mask["name"],
         "leafType": mask["leafType"], "route": mask["route"], "maxLevels": mask["maxLevels"],
         "pixelsAboveSoftLimit": mask["pixelsAboveSoftLimit"]}
        for lane_report in report["lanes"]
        for region_report in [*lane_report.get("regions", []), *lane_report.get("chosenRouteMasks", [])]
        for mask in region_report["masks"]
        if mask.get("measured") and mask["overApprovedSoftLimit"] and not mask["hardEdgeOk"]
    ]

    report["verdicts"] = verdicts()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Preview-versus-export comparison, reference half")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--enforce", action="store_true", help="exit non-zero when a section 4 limit is exceeded")
    arguments = parser.parse_args()
    report = run(Path(arguments.manifest).resolve(), Path(arguments.out).resolve())
    print(f"Wrote {arguments.out} verdicts={json.dumps(report['verdicts'])}")
    if arguments.enforce and not all(report["verdicts"].values()):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
