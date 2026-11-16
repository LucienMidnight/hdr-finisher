"""Opt-in, CPU-only shared scene-grade/Film research; never edits a recipe."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from zipfile import ZipFile

os.environ.setdefault("HDR_CPU_THREADS", "2")
sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--backend", type=Path, default=REPO / "codebase/backend")
parser.add_argument("--backend-revision", default=None)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--only", choices=["charts", "raws", "saved", "character", "timing", "gpu-prepare", "all"], default="all")
parser.add_argument("--repeats", type=int, default=3)
args = parser.parse_args()
sys.path.insert(0, str(args.backend))

import colour
import numpy as np

import hdr_finisher.adjustments as adjustments_module
import hdr_finisher.sdr_match as match_module
from hdr_finisher.color import acescg_to_linear_srgb, linear_bt2020_to_acescg, linear_srgb_to_acescg
from hdr_finisher.color_context import RenderColorContext
from hdr_finisher.models import AdjustmentState, PreviewKind
from lib.machine_settings import settings

OUTPUT = args.output
OUTPUT.mkdir(parents=True, exist_ok=True)
SCALE = float(adjustments_module.SDR_SCENE_TO_DISPLAY_SCALE)
LUMA = np.array([.2126, .7152, .0722])
MATRIX = colour.RGB_COLOURSPACES["sRGB"].matrix_RGB_to_XYZ
WHITE = colour.RGB_COLOURSPACES["sRGB"].whitepoint
STOCKS = [("none", 0)] + [(stock, strength) for stock in
    ["kodak_portra_400", "kodak_ektar_100", "fujifilm_velvia_100"] for strength in [50, 100]]
RAWS = ["A7R00619.ARW", "DSC00264.ARW", "IMG_3129.CR2", "IMG_0790.CR2", "IMG_7723.CR3"]
PHOTOS = Path(settings()["photosRoot"]) / "HDR Test Images"
SOURCES = REPO / "codebase/output/review/m1-all-colours/reduced-sources"
ROWS = []
PATCH_ROWS = []
TIMINGS = []


def save_json(name, value):
    (OUTPUT / name).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def save_csv(name, records):
    if not records:
        return
    with (OUTPUT / name).open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(dict.fromkeys(key for record in records for key in record)))
        writer.writeheader()
        writer.writerows(records)


def flattened(image):
    return np.asarray(image).reshape(-1, 3)


def lab(image):
    return colour.XYZ_to_Lab(np.asarray(image, dtype=float) @ MATRIX.T, WHITE)


def delta(before, after):
    return colour.difference.delta_E_CIE2000(lab(before), lab(after))


def percentile(values, quantile=95):
    return float(np.percentile(values, quantile)) if np.size(values) else None


def grade(stock, strength):
    state = AdjustmentState()
    state.hdr.exposure = .2
    state.hdr.contrast = .12
    state.hdr.saturation = .10
    state.hdr.luma_curve = [[0, 0], [.25, .23], [.5, .5], [.75, .78], [1, 1]]
    state.hdr.film_look.film_stock = stock
    state.hdr.film_look.look_strength = strength
    state.hdr.film_look.grain_enabled = False
    state.hdr.film_look.halation_enabled = False
    state.hdr.film_look_section_enabled = stock != "none"
    return state


def chart(wide):
    families = {"denim": [.045, .12, .30], "indigo": [.06, .07, .28], "cyan": [.03, .28, .30],
        "red": [.40, .04, .025], "green": [.04, .30, .045], "magenta": [.32, .035, .27], "skin": [.45, .23, .14]}
    patches, pixels = [], []
    for family, base in families.items():
        normalized = np.array(base) / (np.array(base) @ LUMA)
        for saturation in [.45, .75, 1.]:
            for stop in range(-4, 4):
                pixels.append(linear_srgb_to_acescg((1 + (normalized - 1) * saturation) * (.18 * 2. ** stop)))
                patches.append(dict(hue=family, saturation=saturation, stop=stop))
    if wide:
        for family, base in [("bt2020_blue", [.02, .06, .8]), ("bt2020_green", [.03, .8, .04])]:
            normalized = linear_bt2020_to_acescg(np.array(base))
            normalized /= float(adjustments_module._acescg_luma(normalized))
            for saturation in [.45, .75, 1.]:
                for stop in range(-4, 4):
                    pixels.append((1 + (normalized - 1) * saturation) * (.18 * 2. ** stop))
                    patches.append(dict(hue=family, saturation=saturation, stop=stop))
    for stop in range(-4, 4):
        pixels.append(np.repeat(.18 * 2. ** stop, 3))
        patches.append(dict(hue="grey", saturation=0., stop=stop))
    return np.asarray(pixels, dtype=np.float32).reshape(-1, 8, 3), patches


def common_scene(source, state, locals_=None, reference_white=203):
    return adjustments_module.apply_adjustments(source, state, PreviewKind.HDR, include_grain=False,
        include_output_highlight_compression=False, apply_output_clamp=False,
        color_context=RenderColorContext(reference_white), local_adjustments=locals_)


def finish(common, state, exposure=0.):
    placed = acescg_to_linear_srgb(common) * np.float32(SCALE * 2. ** exposure)
    return adjustments_module.apply_sdr_output_highlight_compression(placed, state)


def quality(target, actual, body):
    measured = match_module._quality_metrics(target, actual, body).model_dump()
    measured["trial_body_pass"] = measured["p95_oklab_error"] <= .050 and measured["median_oklab_error"] <= .015 \
        and measured["median_luma_error"] <= .010 and measured["p95_luma_error"] <= .030
    return measured


def output_fit(common, target, hdr):
    body = adjustments_module._acescg_luma(hdr) * SCALE <= .9
    best = None
    for mode in ["soft_ceiling", "fixed_cap", "peak_fit", "clip"]:
        for start in ([90] if mode == "clip" else [70, 80, 85, 90, 95, 99]):
            state = AdjustmentState()
            state.sdr.highlight_compression_mode = mode
            state.sdr.highlight_compression_start_percent = start
            state.sdr.highlight_compression_softness = 100
            candidate = finish(common, state)
            measured = quality(target, candidate, body)
            loss = float(np.mean(np.linalg.norm(candidate - target, axis=-1)))
            ordering = match_module._highlight_order_is_safe(hdr, candidate)
            rank = (not measured["trial_body_pass"], loss)
            if best is None or rank < best[0]:
                best = rank, state, candidate, measured, ordering
    _, state, candidate, measured, ordering = best
    raised = finish(common, state, .5)
    growth = float(np.mean(raised @ LUMA >= .999) - np.mean(candidate @ LUMA >= .999))
    return state, candidate, dict(**measured, highlight_order_safe=ordering,
        half_stop_white_growth_points=growth * 100, half_stop_white_growth_pass=growth <= .01,
        mode=state.sdr.highlight_compression_mode, start=state.sdr.highlight_compression_start_percent)


def selections(target, hdr, patches):
    pixels = flattened(target)
    highlights = (adjustments_module._acescg_luma(hdr) * SCALE).reshape(-1) > .9
    result = {"whole": np.ones(len(pixels), dtype=bool), "highlights": highlights}
    if patches:
        result["bright_+1_to_+3"] = np.array([patch["stop"] >= 1 and patch["hue"] != "grey" for patch in patches])
    normalized = pixels * (.18 / np.maximum(pixels @ MATRIX[1], 1e-10))[:, None]
    normalized_lab = lab(normalized)
    chroma = np.linalg.norm(normalized_lab[:, 1:], axis=-1)
    angle = np.degrees(np.arctan2(normalized_lab[:, 2], normalized_lab[:, 1])) % 360
    valid = (chroma >= 5) & (pixels @ LUMA >= .0008)
    for family, lower, upper in [("skin", 25, 75), ("red", 350, 45), ("green", 90, 170),
        ("cyan", 170, 240), ("blue", 240, 310), ("magenta", 310, 350)]:
        selected = ((angle >= lower) & (angle < upper)) if lower < upper else ((angle >= lower) | (angle < upper))
        result[family] = valid & selected
    return result


def summarize(name, stock, strength, variant, before, after, masks):
    errors = delta(flattened(before), flattened(after))
    before_lab, after_lab = lab(flattened(before)), lab(flattened(after))
    before_chroma = np.linalg.norm(before_lab[:, 1:], axis=-1)
    after_chroma = np.linalg.norm(after_lab[:, 1:], axis=-1)
    for family, mask in masks.items():
        valid = mask & (before_chroma >= 5)
        ROWS.append(dict(population=name, stock=stock, strength=strength, variant=variant, family=family,
            count=int(mask.sum()), de00_p95=percentile(errors[mask]), de00_median=percentile(errors[mask], 50),
            chroma_ratio_median=percentile(after_chroma[valid] / before_chroma[valid], 50)))
    return errors


def benchmark(label, function, count):
    function()
    durations = []
    for _ in range(count):
        started = time.perf_counter()
        function()
        durations.append((time.perf_counter() - started) * 1000)
    TIMINGS.append(dict(action=label, machine="MacBook Neo A18 Pro 8 GB", samples_ms=durations,
        median_ms=percentile(durations, 50), min_ms=min(durations), max_ms=max(durations)))


def measure(name, source, patches=None):
    cases = []
    for stock, strength in STOCKS:
        started = time.perf_counter()
        state = grade(stock, strength)
        hdr = adjustments_module.apply_adjustments(source, state, PreviewKind.HDR, include_grain=False,
            color_context=RenderColorContext(203))
        common = common_scene(source, state)
        hdr_trial = adjustments_module.apply_hdr_output_highlight_compression(common, state, color_context=RenderColorContext(203))
        hdr_trial = np.maximum(hdr_trial, 0)
        if not np.array_equal(hdr, hdr_trial):
            raise AssertionError("Shared-film trial changed HDR pixels")
        target = match_module.build_sdr_match_target(hdr)
        masks = selections(target, hdr, patches)
        body = adjustments_module._acescg_luma(hdr) * SCALE <= .9
        baseline_error = None
        baseline_pixels = None
        fit_started = time.perf_counter()
        try:
            matched = match_module.materialize_sdr_match(source, state, [], reference_white_nits=203,
                source_pixel_scale=1., settled_hdr=hdr)
            baseline_pixels = adjustments_module.apply_adjustments(source, matched.adjustments, PreviewKind.SDR, include_grain=False)
            baseline = dict(status=matched.status, quality=quality(target, baseline_pixels, body),
                sdr=matched.adjustments.sdr.model_dump(mode="json"))
            baseline["highlight_order_safe"] = match_module._highlight_order_is_safe(hdr, baseline_pixels)
            baseline_error = summarize(name, stock, strength, "incumbent_residual", target, baseline_pixels, masks)
            saved_trial = finish(common, matched.adjustments)
            summarize(name, stock, strength, "saved_recipe_drift", baseline_pixels, saved_trial, masks)
            (OUTPUT / f"{name}-{stock}-{strength}-recipe.json").write_text(matched.adjustments.model_dump_json())
        except match_module.SDRMatchMaterializationError as error:
            baseline = dict(status="refused", error=str(error))
        baseline["match_ms"] = (time.perf_counter() - fit_started) * 1000
        fit_started = time.perf_counter()
        fit_state, trial_pixels, trial_quality = output_fit(common, target, hdr)
        trial_quality["fit_ms"] = (time.perf_counter() - fit_started) * 1000
        trial_quality["target_itself_order_safe"] = match_module._highlight_order_is_safe(hdr, target)
        trial_error = summarize(name, stock, strength, "equal_input_residual", target, trial_pixels, masks)
        summarize(name, stock, strength, "inherent_hdr_to_target", acescg_to_linear_srgb(hdr) / .18, target, masks)
        no_map = fit_state.model_copy(deep=True)
        no_map.sdr.highlight_section_enabled = False
        no_map_pixels = finish(common, no_map)
        summarize(name, stock, strength, "film_without_output_HC_residual", target, no_map_pixels, masks)
        summarize(name, stock, strength, "HC_change_from_print_only", no_map_pixels, trial_pixels, masks)
        ordered_quality = dict(body=trial_quality, baseline=baseline, hdr_exact=True,
            print_only_white_percent=float(np.mean(no_map_pixels @ LUMA >= .999) * 100),
            trial_white_percent=float(np.mean(trial_pixels @ LUMA >= .999) * 100),
            scene_film_max=float(np.max(acescg_to_linear_srgb(common) * SCALE)))
        if patches:
            grey = np.array([patch["hue"] == "grey" for patch in patches])
            grey_luma = (flattened(trial_pixels) @ LUMA)[grey]
            print_luma = (flattened(no_map_pixels) @ LUMA)[grey]
            ordered_quality["grey_stops"] = list(range(-4, 4))
            ordered_quality["grey_output"] = grey_luma.tolist()
            ordered_quality["grey_print_only"] = print_luma.tolist()
            for index, patch in enumerate(patches):
                PATCH_ROWS.append(dict(population=name, stock=stock, strength=strength, **patch,
                    before_de00=None if baseline_error is None else float(baseline_error[index]),
                    after_de00=float(trial_error[index]),
                    print_only_de00=float(delta(flattened(target)[index:index+1], flattened(no_map_pixels)[index:index+1])[0])))
            np.savez_compressed(OUTPUT / f"{name}-{stock}-{strength}-gpu.npz", source=source, hdr=hdr,
                common=common, trial=trial_pixels, adjustments=np.array(state.model_dump_json()),
                output_adjustments=np.array(fit_state.model_dump_json()))
        cases.append(dict(stock=stock, strength=strength, **ordered_quality))
        if name == "DSC00264.ARW":
            timing_state = matched.adjustments if baseline_pixels is not None else state
            benchmark(f"{name}/{stock}/{strength}/incumbent_SDR", lambda: adjustments_module.apply_adjustments(
                source, timing_state, PreviewKind.SDR, include_grain=False), args.repeats)
            benchmark(f"{name}/{stock}/{strength}/trial_SDR_standalone", lambda: finish(common_scene(source, state), fit_state), args.repeats)
            benchmark(f"{name}/{stock}/{strength}/trial_SDR_shared_tail", lambda: finish(common, fit_state), args.repeats)
        print(name, stock, strength, baseline["status"], json.dumps(trial_quality), round(time.perf_counter()-started, 3), flush=True)
        save_csv("summary.csv", ROWS)
        save_csv("patches.csv", PATCH_ROWS)
        save_json(f"{name}-cases.json", cases)
        save_json("cpu-timing.json", TIMINGS)


def saved_project():
    from hdr_finisher.loader import load_image
    from hdr_finisher.projects import validate_saved_document
    protected = PHOTOS / "Projects/DSC00950.hdrfinisher"
    digest_before = hashlib.sha256(protected.read_bytes()).hexdigest()
    with ZipFile(protected) as archive:
        document = json.loads(archive.read("edit-state.json"))
    original = PHOTOS / document["source"]["filename"]
    source_digest = hashlib.sha256(original.read_bytes()).hexdigest()
    if source_digest != document["source"]["fingerprint_sha256"]:
        raise ValueError("Canonical DSC00950 source fingerprint differs from protected project")
    recovered = validate_saved_document(document)
    decoded = load_image(original, library_edge=512, analyze_hdr=False,
        raw_import_settings=recovered.source.raw_import_settings)[0]
    stride = max(1, int(np.ceil(max(decoded.shape[:2]) / 512)))
    source = np.ascontiguousarray(decoded[::stride, ::stride])
    del decoded
    state = recovered.global_adjustments
    locals_ = recovered.local_adjustments
    white = document.get("hdr_reference_white_nits", 203)
    hdr = adjustments_module.apply_adjustments(source, state, PreviewKind.HDR, include_grain=False,
        local_adjustments=locals_, color_context=RenderColorContext(white))
    baseline = adjustments_module.apply_adjustments(source, state, PreviewKind.SDR, include_grain=False, local_adjustments=locals_)
    common = common_scene(source, state, locals_, white)
    trial = finish(common, state)
    masks = selections(match_module.build_sdr_match_target(hdr), hdr, None)
    summarize("DSC00950_saved", state.hdr.film_look.film_stock, state.hdr.film_look.look_strength,
        "saved_recipe_drift", baseline, trial, masks)
    digest_after = hashlib.sha256(protected.read_bytes()).hexdigest()
    if digest_before != digest_after:
        raise AssertionError("Protected project changed")
    save_json("DSC00950-saved.json", dict(project_sha256=digest_before, source_sha256=source_digest,
        source_matches_project=True, original_windows_path=document["source"]["durable_path"],
        shape=list(source.shape), local_count=len(locals_), hdr_film=state.hdr.film_look.model_dump(mode="json"),
        sdr_film=state.sdr.film_look.model_dump(mode="json"), reference_white=white,
        recovery_notice=getattr(recovered, "_saved_grade_notice", None)))
    save_csv("saved-summary.csv", ROWS)


if args.only == "gpu-prepare":
    gpu_source = np.load(SOURCES / "DSC00264.ARW.npz")["source"]
    source_rgba = np.concatenate([gpu_source, np.ones((*gpu_source.shape[:2], 1), dtype=np.float32)], axis=-1)
    source_rgba.astype("<f4").tofile(OUTPUT / "gpu-source.rgba32f")
    cases = []
    measured_cases = json.loads((OUTPUT / "DSC00264.ARW-cases.json").read_text())
    for stock, strength in STOCKS:
        state = grade(stock, strength)
        selected = next(case for case in measured_cases if case["stock"] == stock and case["strength"] == strength)
        output_state = AdjustmentState()
        output_state.sdr.highlight_compression_mode = selected["body"]["mode"]
        output_state.sdr.highlight_compression_start_percent = selected["body"]["start"]
        output_state.sdr.highlight_compression_softness = 100
        recipe_path = OUTPUT / f"DSC00264.ARW-{stock}-{strength}-recipe.json"
        if not recipe_path.exists():
            continue
        incumbent_state = AdjustmentState.model_validate_json(recipe_path.read_text())
        pixels = finish(common_scene(gpu_source, state), output_state)
        pixels.astype("<f4").tofile(OUTPUT / f"gpu-golden-{stock}-{strength}.rgb32f")
        cases.append(dict(stock=stock, strength=strength, state=state.model_dump(mode="json"),
            incumbent=incumbent_state.model_dump(mode="json"), output=output_state.model_dump(mode="json")))
    save_json("gpu-cases.json", dict(width=gpu_source.shape[1], height=gpu_source.shape[0], cases=cases))
    sys.exit(0)

if args.only == "character":
    character_rows = []
    for population in ["chart176", "chart224"]:
        _, patches = chart(population == "chart224")
        for stock, strength in STOCKS:
            data = np.load(OUTPUT / f"{population}-{stock}-{strength}-gpu.npz")
            common = data["common"]
            output = data["trial"]
            placed = acescg_to_linear_srgb(common) * SCALE
            print_only = adjustments_module._compress_to_srgb_gamut(placed)
            grey = np.array([patch["hue"] == "grey" for patch in patches])
            grey_output = (flattened(output) @ LUMA)[grey]
            grey_print = (flattened(print_only) @ LUMA)[grey]
            raw_lab = lab(flattened(placed) * (.18 / np.maximum(flattened(placed) @ MATRIX[1], 1e-10))[:, None])
            output_lab = lab(flattened(output) * (.18 / np.maximum(flattened(output) @ MATRIX[1], 1e-10))[:, None])
            raw_chroma = np.linalg.norm(raw_lab[:, 1:], axis=-1)
            output_chroma = np.linalg.norm(output_lab[:, 1:], axis=-1)
            incumbent_chroma = None
            incumbent_grey = None
            recipe_path = OUTPUT / f"{population}-{stock}-{strength}-recipe.json"
            if recipe_path.exists():
                incumbent_state = AdjustmentState.model_validate_json(recipe_path.read_text())
                incumbent = adjustments_module.apply_adjustments(data["source"], incumbent_state,
                    PreviewKind.SDR, include_grain=False)
                incumbent_flat = flattened(incumbent)
                incumbent_grey = (incumbent_flat @ LUMA)[grey]
                incumbent_lab = lab(incumbent_flat * (.18 / np.maximum(incumbent_flat @ MATRIX[1], 1e-10))[:, None])
                incumbent_chroma = np.linalg.norm(incumbent_lab[:, 1:], axis=-1)
            for family in sorted({patch["hue"] for patch in patches} - {"grey"}):
                for zone, low, high in [("body", -4, 0), ("bright", 1, 3)]:
                    selected = np.array([patch["hue"] == family and low <= patch["stop"] <= high for patch in patches]) & (raw_chroma >= 5)
                    comparable = selected if incumbent_chroma is None else selected & (incumbent_chroma >= 5)
                    character_rows.append(dict(population=population, stock=stock, strength=strength,
                        hue=family, zone=zone, count=int(selected.sum()),
                        normalized_chroma_ratio=percentile(output_chroma[selected] / raw_chroma[selected], 50),
                        trial_vs_incumbent_chroma_ratio=None if incumbent_chroma is None else
                            percentile(output_chroma[comparable] / incumbent_chroma[comparable], 50),
                        incumbent_body_log_slope=None if incumbent_grey is None else
                            float(np.log2(incumbent_grey[4] / incumbent_grey[2]) / 2),
                        incumbent_bright_log_slope=None if incumbent_grey is None else
                            float(np.log2(incumbent_grey[7] / incumbent_grey[5]) / 2),
                        grey_body_log_slope=float(np.log2(grey_output[4] / grey_output[2]) / 2),
                        print_body_log_slope=float(np.log2(grey_print[4] / grey_print[2]) / 2),
                        grey_bright_log_slope=float(np.log2(grey_output[7] / grey_output[5]) / 2),
                        print_bright_log_slope=float(np.log2(grey_print[7] / grey_print[5]) / 2),
                        above_sdr_white_percent=float(np.mean(placed @ LUMA > 1) * 100),
                        grey_output=grey_output.tolist(), grey_print_only=grey_print.tolist()))
            variants = []
            for variant in ["print_only", "selected_tail", "peak_fit_smooth", "peak_fit_preserve", "double_soft_ceiling"]:
                state = AdjustmentState()
                state.sdr.highlight_compression_mode = "peak_fit"
                state.sdr.highlight_compression_color_handling = "preserve_color" if variant == "peak_fit_preserve" else "smooth_rolloff"
                if variant == "print_only":
                    candidate = print_only
                elif variant == "selected_tail":
                    candidate = output
                elif variant == "double_soft_ceiling":
                    state.sdr.highlight_compression_mode = "soft_ceiling"
                    state.sdr.highlight_compression_softness = 100
                    state.sdr.highlight_compression_start_percent = 70
                    candidate = adjustments_module.apply_sdr_output_highlight_compression(output, state)
                else:
                    candidate = finish(common, state)
                target = match_module.build_sdr_match_target(data["hdr"])
                body = adjustments_module._acescg_luma(data["hdr"]) * SCALE <= .9
                bright = np.array([patch["stop"] >= 1 and patch["hue"] != "grey" for patch in patches])
                candidate_lab = lab(flattened(candidate) * (.18 / np.maximum(flattened(candidate) @ MATRIX[1], 1e-10))[:, None])
                chroma = np.linalg.norm(candidate_lab[:, 1:], axis=-1)
                selected = bright & (raw_chroma >= 5)
                variants.append(dict(variant=variant, quality=quality(target, candidate, body),
                    bright_de00_p95=percentile(delta(flattened(target), flattened(candidate))[bright]),
                    bright_normalized_chroma_ratio=percentile(chroma[selected] / raw_chroma[selected], 50),
                    grey_body_log_slope=float(np.log2((flattened(candidate) @ LUMA)[grey][4] / (flattened(candidate) @ LUMA)[grey][2]) / 2)))
            save_json(f"{population}-{stock}-{strength}-tails.json", variants)
    save_json("character.json", character_rows)
    sys.exit(0)

save_json("manifest.json", dict(backend=str(args.backend), backend_revision=args.backend_revision,
    repo_head=subprocess.check_output(
    ["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
    source_files={str(path.relative_to(args.backend)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted((args.backend / "hdr_finisher").glob("*.py"))},
    conditions="A18 Pro 8GB; CPU threads=2; reduced <=512px RAWs; grain/halation off; no exports; 10% exploratory timing noise"))
if args.only == "timing":
    timing_source = np.load(SOURCES / "DSC00264.ARW.npz")["source"]
    timing_cases = json.loads((OUTPUT / "gpu-cases.json").read_text())
    pair_rows = []
    for case in timing_cases["cases"]:
        scene_state = AdjustmentState.model_validate(case["state"])
        incumbent_state = AdjustmentState.model_validate(case["incumbent"])
        output_state = AdjustmentState.model_validate(case["output"])
        def incumbent_pair():
            hdr = adjustments_module.apply_adjustments(timing_source, scene_state, PreviewKind.HDR, include_grain=False)
            sdr = adjustments_module.apply_adjustments(timing_source, incumbent_state, PreviewKind.SDR, include_grain=False)
            return hdr, sdr
        def trial_pair():
            common = common_scene(timing_source, scene_state)
            hdr = adjustments_module.apply_hdr_output_highlight_compression(common, scene_state, color_context=RenderColorContext(203))
            return hdr, finish(common, output_state)
        incumbent_pair()
        trial_pair()
        samples = {"incumbent_pair": [], "trial_pair": []}
        for repeat in range(args.repeats):
            ordered = [("incumbent_pair", incumbent_pair), ("trial_pair", trial_pair)]
            if repeat % 2:
                ordered.reverse()
            for label, function in ordered:
                started = time.perf_counter()
                function()
                samples[label].append((time.perf_counter() - started) * 1000)
        pair_rows.append(dict(stock=case["stock"], strength=case["strength"],
            machine="MacBook Neo A18 Pro 8 GB", shape=list(timing_source.shape), samples_ms=samples))
    save_json("cpu-pair-timing.json", pair_rows)
if args.only in ["charts", "all"]:
    for wide in [False, True]:
        source, patches = chart(wide)
        measure("chart224" if wide else "chart176", source, patches)
if args.only in ["raws", "all"]:
    for photo in RAWS:
        measure(photo, np.load(SOURCES / (photo + ".npz"))["source"])
if args.only in ["saved", "all"]:
    saved_project()
