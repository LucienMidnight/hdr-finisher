from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
from platform import platform, python_version
import sys
from time import perf_counter

import numpy as np
import tifffile

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from hdr_finisher.adjustments import apply_adjustments
from hdr_finisher.capabilities import probe_capabilities
from hdr_finisher.color_context import RenderColorContext, scene_linear_to_nits
from hdr_finisher.models import AdjustmentState, EditDocument, LocalAdjustment, PreviewKind, SourceImageDescriptor
from hdr_finisher.loader import load_image
from hdr_finisher.overlay import build_overlay_rgba
from hdr_finisher.render_cache import SessionRenderCache
from hdr_finisher.scopes import build_scope
from hdr_finisher.source_luminance import describe_source_luminance


GOLDEN = ROOT / "tests" / "golden"
REPORTS = ROOT / "output" / "golden-reports"


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _recipe(name: str) -> tuple[AdjustmentState, list[LocalAdjustment]]:
    payload = _load_json(GOLDEN / "recipes" / f"{name}.json")
    adjustments = AdjustmentState.model_validate(payload.get("global_adjustments", {}))
    locals_ = [LocalAdjustment.model_validate(value) for value in payload.get("local_adjustments", [])]
    return adjustments, locals_


def _check(name: str, passed: bool, measured: object, expected: object) -> dict:
    return {"name": name, "status": "pass" if passed else "fail", "measured": measured, "expected": expected}


def run(tier: str) -> dict:
    started = perf_counter()
    manifest = _load_json(GOLDEN / "manifest.json")
    fixture = ROOT / manifest["journeys"]["synthetic_numerical_reference"]["fixture"]
    image = tifffile.imread(fixture).astype(np.float32)
    neutral, no_locals = _recipe("neutral")
    representative, representative_locals = _recipe("representative_grade")
    rw100 = RenderColorContext(100)
    rw203 = RenderColorContext(203)
    checks: list[dict] = []

    first_row = image[2]
    measured_patches = [float(scene_linear_to_nits(first_row[index * 10, 1], 203)) for index in range(7)]
    expected_patches = [0.0, 0.1, 100.0, 203.0, 406.0, 1000.0, 12000.0]
    patch_error = float(np.max(np.abs(np.asarray(measured_patches) - expected_patches)))
    checks.append(_check("synthetic absolute-nit patches", patch_error <= 0.02, measured_patches, expected_patches))

    neutral_hdr = apply_adjustments(image, neutral, PreviewKind.HDR, color_context=rw203)
    sample = np.array([0.018, 0.18, 1.8], dtype=np.float32)
    ratio = scene_linear_to_nits(sample, 203) / scene_linear_to_nits(sample, 100)
    max_ratio_error = float(np.max(np.abs(ratio - 2.03)))
    checks.append(_check("pure reference-white scale", max_ratio_error <= 0.00005, ratio.tolist(), 2.03))

    sdr100 = apply_adjustments(image, neutral, PreviewKind.SDR, color_context=rw100)
    sdr203 = apply_adjustments(image, neutral, PreviewKind.SDR, color_context=rw203)
    sdr_delta = float(np.max(np.abs(sdr100 - sdr203)))
    checks.append(_check("generated SDR pure-change invariant", sdr_delta == 0.0, sdr_delta, 0.0))

    mapper_contract = manifest["sdr_tone_mappers"]
    mapper_anchor = float(mapper_contract["scene_middle_gray"])
    mapper_reference = float(mapper_contract["display_reference_white"])
    mapper_anchor_tolerance = float(mapper_contract["anchor_tolerance"])
    mapper_monotonic_tolerance = float(mapper_contract["monotonic_tolerance"])
    mapper_ramp = np.repeat(np.geomspace(0.001, 1000.0, 4097, dtype=np.float32).reshape(1, -1, 1), 3, axis=2)
    mapper_measurements: dict[str, dict[str, float | bool]] = {}
    mapper_contract_passed = True
    for mapper in mapper_contract["tone_mappers"]:
        mapper_state = AdjustmentState.model_validate(
            {"sdr": {"tone_mapper": mapper, "highlight_recovery": 0.0}}
        )
        anchor_patch = np.full((1, 1, 3), mapper_anchor, dtype=np.float32)
        generated_anchor = float(apply_adjustments(anchor_patch, mapper_state, PreviewKind.SDR)[0, 0, 0])
        authored_patch = np.full((1, 1, 3), mapper_reference, dtype=np.float32)
        authored_anchor = float(
            apply_adjustments(
                anchor_patch,
                mapper_state,
                PreviewKind.SDR,
                sdr_reference_image=authored_patch,
            )[0, 0, 0]
        )
        rendered_ramp = apply_adjustments(mapper_ramp, mapper_state, PreviewKind.SDR)[0, :, 0]
        minimum_step = float(np.min(np.diff(rendered_ramp)))
        generated_error = abs(generated_anchor - mapper_reference)
        authored_error = abs(authored_anchor - mapper_reference)
        mapper_passed = (
            generated_error <= mapper_anchor_tolerance
            and authored_error <= mapper_anchor_tolerance
            and minimum_step >= -mapper_monotonic_tolerance
        )
        mapper_contract_passed = mapper_contract_passed and mapper_passed
        mapper_measurements[mapper] = {
            "generated_anchor": generated_anchor,
            "authored_anchor": authored_anchor,
            "generated_anchor_error": generated_error,
            "authored_anchor_error": authored_error,
            "minimum_ramp_step": minimum_step,
            "passed": mapper_passed,
        }
    checks.append(
        _check(
            "SDR tone mappers share the reference-white exposure anchor",
            mapper_contract_passed,
            mapper_measurements,
            {
                "generated_anchor_error": f"<= {mapper_anchor_tolerance}",
                "authored_anchor_error": f"<= {mapper_anchor_tolerance}",
                "minimum_ramp_step": f">= {-mapper_monotonic_tolerance}",
            },
        )
    )

    recovery_contract = manifest["sdr_highlight_recovery"]
    recovery_strength = float(recovery_contract["strength"])
    recovery_pivot = float(recovery_contract["display_reference_white"])
    recovery_tolerance = float(recovery_contract["monotonic_tolerance"])
    scene_ramp = np.repeat(np.linspace(0.0, 32.0, 4097, dtype=np.float32).reshape(1, -1, 1), 3, axis=2)
    recovery_measurements: dict[str, dict[str, float | bool]] = {}
    recovery_passed = True
    for mapper in recovery_contract["tone_mappers"]:
        baseline_adjustments = AdjustmentState.model_validate(
            {"sdr": {"tone_mapper": mapper, "highlight_recovery": 0.0}}
        )
        recovered_adjustments = AdjustmentState.model_validate(
            {"sdr": {"tone_mapper": mapper, "highlight_recovery": recovery_strength}}
        )
        baseline_ramp = apply_adjustments(scene_ramp, baseline_adjustments, PreviewKind.SDR)[0, :, 0]
        recovered_ramp = apply_adjustments(scene_ramp, recovered_adjustments, PreviewKind.SDR)[0, :, 0]
        below_reference = baseline_ramp <= recovery_pivot
        below_reference_delta = float(np.max(np.abs(recovered_ramp[below_reference] - baseline_ramp[below_reference])))
        minimum_step = float(np.min(np.diff(recovered_ramp)))
        recovered_peak = float(recovered_ramp[-1])
        mapper_passed = (
            below_reference_delta <= recovery_tolerance
            and minimum_step >= -recovery_tolerance
            and recovered_peak >= float(recovery_contract["minimum_recovered_peak"])
        )
        recovery_passed = recovery_passed and mapper_passed
        recovery_measurements[mapper] = {
            "below_reference_max_delta": below_reference_delta,
            "minimum_ramp_step": minimum_step,
            "recovered_peak": recovered_peak,
            "passed": mapper_passed,
        }
    reference_white = np.ones((1, 1, 3), dtype=np.float32)
    white_state = AdjustmentState.model_validate(
        {"sdr": {"base_section_enabled": False, "highlight_recovery": recovery_strength}}
    )
    recovered_white = apply_adjustments(
        reference_white,
        white_state,
        PreviewKind.SDR,
        sdr_reference_image=reference_white,
    )
    white_error = float(np.max(np.abs(recovered_white - 1.0)))
    recovery_passed = recovery_passed and white_error <= recovery_tolerance
    recovery_measurements["white_endpoint"] = {
        "max_error": white_error,
        "passed": white_error <= recovery_tolerance,
    }
    checks.append(
        _check(
            "SDR highlight recovery preserves reference, ordering, and white",
            recovery_passed,
            recovery_measurements,
            {
                "below_reference_max_delta": f"<= {recovery_tolerance}",
                "minimum_ramp_step": f">= {-recovery_tolerance}",
                "recovered_peak": f">= {recovery_contract['minimum_recovered_peak']}",
                "white_endpoint_max_error": f"<= {recovery_tolerance}",
            },
        )
    )

    band_contract = manifest["sdr_exposure_bands"]
    display_ramp = np.repeat(np.linspace(0.001, 1.0, 4097, dtype=np.float32).reshape(1, -1, 1), 3, axis=2)
    band_state = AdjustmentState.model_validate(
        {
            "sdr": {
                "base_section_enabled": False,
                "highlight_recovery": 0.0,
                "tone_equalizer_nodes": band_contract["nodes"],
                "tone_equalizer_smoothing": band_contract["smoothing"],
            }
        }
    )
    band_bypass = band_state.model_copy(deep=True)
    band_bypass.sdr.tone_equalizer_section_enabled = False
    band_output = apply_adjustments(
        display_ramp,
        band_state,
        PreviewKind.SDR,
        sdr_reference_image=display_ramp,
    )[0, :, 0]
    bypass_output = apply_adjustments(
        display_ramp,
        band_bypass,
        PreviewKind.SDR,
        sdr_reference_image=display_ramp,
    )[0, :, 0]
    band_minimum_step = float(np.min(np.diff(band_output)))
    band_changed = float(np.max(np.abs(band_output - bypass_output)))
    band_tolerance = float(band_contract["monotonic_tolerance"])
    checks.append(
        _check(
            "SDR exposure bands are effective and monotonic on authored SDR",
            band_changed > band_tolerance and band_minimum_step >= -band_tolerance,
            {"maximum_change": band_changed, "minimum_ramp_step": band_minimum_step},
            {"maximum_change": f"> {band_tolerance}", "minimum_ramp_step": f">= {-band_tolerance}"},
        )
    )

    fixed100 = apply_adjustments(image, representative, PreviewKind.HDR, local_adjustments=representative_locals, color_context=rw100)
    fixed203 = apply_adjustments(image, representative, PreviewKind.HDR, local_adjustments=representative_locals, color_context=rw203)
    fixed_delta = float(np.mean(np.abs(fixed100 - fixed203)))
    checks.append(_check("fixed-nit grade changes shape", fixed_delta > 0.0, fixed_delta, "> 0"))

    scope = build_scope(neutral_hdr, neutral, PreviewKind.HDR, color_context=rw203)
    scope_peak = float(scope.peak_value)
    expected_peak = float(np.max(scene_linear_to_nits(neutral_hdr, 203)))
    checks.append(_check("CPU/scope nit agreement", abs(scope_peak - expected_peak) <= 0.02, scope_peak, expected_peak))

    overlay_adjustments = neutral.model_copy(deep=True)
    overlay_adjustments.shared.overlay_mode = "false_color"
    overlay_adjustments.shared.false_color_band_anchor = "100_nits"
    overlay100 = build_overlay_rgba(image, overlay_adjustments, PreviewKind.HDR, color_context=rw100)
    overlay203 = build_overlay_rgba(image, overlay_adjustments, PreviewKind.HDR, color_context=rw203)
    checks.append(_check("fixed false-color anchor independent of project", bool(np.array_equal(overlay100, overlay203)), bool(np.array_equal(overlay100, overlay203)), True))

    cache = SessionRenderCache(image, None, color_context=rw100)
    source_before, _ = cache.source_proxy(PreviewKind.HDR, 512)
    cache.adjusted_frame(neutral, PreviewKind.HDR, 512)
    cache.set_color_context(rw203)
    source_after, _ = cache.source_proxy(PreviewKind.HDR, 512)
    checks.append(_check("reference change reuses source proxy", source_before is source_after, source_before is source_after, True))

    source = SourceImageDescriptor(
        filename=fixture.name,
        suffix=".tiff",
        width=image.shape[1],
        height=image.shape[0],
        channels=image.shape[2],
        dtype=str(image.dtype),
        transfer_function="LINEAR",
    )
    descriptor = describe_source_luminance(source, {"transfer_function": "LINEAR"}, has_authored_sdr=False)
    document = EditDocument(
        hdr_reference_white_nits=203,
        source={"filename": fixture.name, "luminance": descriptor.model_dump(mode="json")},
    )
    checks.append(_check("new v3 project default contract", document.schema_version == 3 and document.hdr_reference_white_nits == 203, document.model_dump(mode="json"), "schema 3 / 203 nit"))

    capability_map = {
        key: {"status": value.status.value, "detail": value.detail}
        for key, value in probe_capabilities().items()
        if key in {"ultrahdr_encoder", "avif_gain_map_encoder", "jpegxl_export"}
    }
    journeys = {}
    for name, journey in manifest["journeys"].items():
        path = ROOT / journey["fixture"]
        journeys[name] = {
            "fixture": str(path),
            "available": path.exists(),
            "required_for_tier": tier in journey["required_tiers"],
            "external_qualification_reason": journey.get("external_qualification_reason"),
        }

    if tier in {"nightly", "release"}:
        gain_map_path = ROOT / manifest["journeys"]["authored_gain_map_photograph"]["fixture"]
        if gain_map_path.exists():
            gain_hdr, _gain_source, gain_metadata, _gain_analysis, authored_sdr = load_image(
                gain_map_path,
                hdr_reference_white_nits=203,
            )
            checks.append(
                _check(
                    "authored gain-map renditions recovered",
                    bool(gain_metadata.get("gain_map_applied")) and authored_sdr is not None and authored_sdr.shape == gain_hdr.shape,
                    {
                        "gain_map_applied": bool(gain_metadata.get("gain_map_applied")),
                        "sdr_preserved": authored_sdr is not None,
                    },
                    {"gain_map_applied": True, "sdr_preserved": True},
                )
            )
            authored100 = apply_adjustments(
                gain_hdr,
                neutral,
                PreviewKind.SDR,
                sdr_reference_image=authored_sdr,
                color_context=rw100,
            )
            authored203 = apply_adjustments(
                gain_hdr,
                neutral,
                PreviewKind.SDR,
                sdr_reference_image=authored_sdr,
                color_context=rw203,
            )
            authored_delta = float(np.max(np.abs(authored100 - authored203)))
            checks.append(_check("authored SDR reference-switch invariant", authored_delta == 0.0, authored_delta, 0.0))

    external_gaps = [
        name
        for name, journey in journeys.items()
        if journey["required_for_tier"] and not journey["available"]
    ]
    checks_passed = all(item["status"] == "pass" for item in checks)
    status = "fail" if not checks_passed else ("pass_with_external_gaps" if external_gaps else "pass")

    return {
        "contract_version": manifest["contract_version"],
        "tier": tier,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "environment": {"platform": platform(), "python": python_version()},
        "status": status,
        "duration_ms": round((perf_counter() - started) * 1000, 2),
        "checks": checks,
        "journeys": journeys,
        "exporter_capabilities": capability_map,
        "external_gaps": external_gaps,
        "qualification_note": "WebGPU, packaged Electron, browser/compositor, and physical-display gates are reported by their dedicated suites and release environment record.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the HDR Finisher rw203 Golden Pipeline analytical tier.")
    parser.add_argument("--tier", choices=("pr", "nightly", "release"), default="pr")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = run(args.tier)
    REPORTS.mkdir(parents=True, exist_ok=True)
    destination = args.report or REPORTS / f"{report['contract_version']}-{args.tier}.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "report": str(destination), "duration_ms": report["duration_ms"]}, indent=2))
    return 0 if report["status"] in {"pass", "pass_with_external_gaps"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
