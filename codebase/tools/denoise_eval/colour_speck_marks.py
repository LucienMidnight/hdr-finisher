"""Fixed-location attribution for Steve's marked Denoise spots. Research only."""
import argparse
from collections import Counter
import json
from pathlib import Path

import cv2
import numpy as np
import rawpy

from hdr_finisher import denoise_adaptive as adaptive
from hdr_finisher import raw_import, raw_pixel_cleanup, raw_speck_cleanup
from hdr_finisher.color import acescg_to_linear_srgb
from tools.denoise_eval import marking_page as marking
from tools.denoise_eval.keep_survivors import RX, RY
from tools.lib.test_photos import manifest_files, photo_root, sha256

MARKS = marking.AREAS.with_name("steve-marks-2026-11-18.json")
OUTPUT = marking.OUTPUT.with_name("colour-trials")
# Orthonormal chroma axes in display RGB, with positive green and positive red.
DISPLAY_AXES = np.array([[0, 0, 0], [-1, 2, -1], [1, 0, -1]], np.float32)
DISPLAY_AXES[0] = marking.LUMA
DISPLAY_AXES[1] /= np.sqrt(6)
DISPLAY_AXES[2] /= np.sqrt(2)
DISPLAY_FLOOR = 1 / 255
PAD = 84


def inputs():
    areas = json.loads(marking.AREAS.read_text())["photos"]
    answers = json.loads(MARKS.read_text())
    if answers["area_set_sha256"] != sha256(marking.AREAS):
        raise ValueError("The marks do not match these areas")
    known = {(file, area["id"]) for file, fixed in areas.items() for area in fixed}
    for mark in answers["marks"]:
        if ((mark["file"], mark["area_id"]) not in known
                or mark["column"] != "even_out" or mark["type"] != "distracting_spot"):
            raise ValueError("Expected a distracting-spot mark on the Even out baseline")
    return areas, answers


def rectangle(area, width, height, pad=0):
    left, top, right, bottom = marking.bounds_for(area, width, height)
    return max(0, left-pad), max(0, top-pad), min(width, right+pad), min(height, bottom+pad)


def crop(image, rect):
    left, top, right, bottom = rect
    return image[top:bottom, left:right]


def oriented_rect(rect, width, height, flip):
    l, t, r, b = rect
    return {0: (l, t, r, b), 3: (width-r, height-b, width-l, height-t),
            5: (t, width-r, b, width-l), 6: (height-b, l, height-t, r)}[flip]


def region(full, rect, width, height, flip):
    l, t, r, b = oriented_rect(rect, width, height, flip)
    h, w = full.shape[:2]
    return full[t:b, l:r], adaptive._Edges(t == 0, b == h, l == 0, r == w, h, w)


def inner_rect(area, rect, width, height):
    l, t, r, b = rectangle(area, width, height)
    return l-rect[0], t-rect[1], r-rect[0], b-rect[1]


def display_axes(rgb, ev):
    linear = acescg_to_linear_srgb(rgb)
    display = marking.display_pixels(linear, ev).astype(np.float32) / 255
    return display @ DISPLAY_AXES.T


def ring(axes, x, y):
    yy, xx = y + RY, x + RX
    valid = (xx >= 0) & (xx < axes.shape[1]) & (yy >= 0) & (yy < axes.shape[0])
    values = axes[yy[valid], xx[valid]]
    return np.median(values, axis=0), values


def locate(baseline, x, y):
    reference, samples = ring(baseline, x, y)
    grain = np.maximum(np.median(np.abs(samples - reference), axis=0) * 1.4826, DISPLAY_FLOOR)
    h, w = baseline.shape[:2]
    l, t, r, b = max(0, x-2), max(0, y-2), min(w, x+3), min(h, y+3)
    offsets = baseline[t:b, l:r] - reference
    # A single deterministic recentering from the baseline; identical in every comparison.
    yy, xx = np.unravel_index(np.argmax(np.linalg.norm(offsets / grain, axis=-1)), offsets.shape[:2])
    return l+int(xx), t+int(yy)


def readings(axes, x, y, direction, luma_sign):
    reference, samples = ring(axes, x, y)
    residual = axes[y, x] - reference
    projected = (samples[:, 1:] - reference[1:]) @ direction
    colour_grain = max(float(np.median(np.abs(projected)) * 1.4826), DISPLAY_FLOOR)
    luma_grain = max(float(np.median(np.abs(samples[:, 0] - reference[0])) * 1.4826), DISPLAY_FLOOR)
    colour = float(residual[1:] @ direction)
    luma = float(residual[0])
    return dict(luma=luma, green_magenta=float(residual[1]), red_blue=float(residual[2]),
                colour=colour, colour_grain=colour_grain, luma_grain=luma_grain,
                colour_score=colour / colour_grain, luma_score=luma_sign * luma / luma_grain)


def footprint(axes, x, y, axis, cutoff, reference):
    h, w = axes.shape[:2]
    l, t, r, b = max(0, x-12), max(0, y-12), min(w, x+13), min(h, y+13)
    selected = ((axes[t:b, l:r] - reference) @ axis >= cutoff).astype("uint8")
    _, labels, stats, _ = cv2.connectedComponentsWithStats(selected, connectivity=8)
    label = labels[y-t, x-l]
    if not label:
        return 0, False
    fx, fy, fw, fh, count = stats[label]
    return int(count), bool(fx == 0 or fy == 0 or fx+fw == r-l or fy+fh == b-t)


def sensor_patch(sensor, fit, rect):
    # Keep the original Bayer phase and sufficient context for the actual clamp.
    l, t, r, b = rect
    y0, x0 = max(0, t-32)//2*2, max(0, l-32)//2*2
    original = sensor[y0:b+32, x0:r+32].copy()
    clamped = original.copy()
    raw_speck_cleanup.apply(clamped, fit, 2.5)
    z_planes = []
    for values in (original, clamped):
        signed = raw_pixel_cleanup._normalise(values, fit["black"], fit["spans"])
        z = np.empty_like(signed)
        for phase, noise in enumerate(fit["noise"]):
            index = np.s_[phase//2::2, phase%2::2]
            plane = signed[index]
            median = cv2.medianBlur(plane, 5)
            delta = plane - median
            sigma = np.maximum(np.sqrt(noise["a"] * np.maximum(median, 0) + noise["b"]),
                               1.4826 * cv2.medianBlur(np.abs(delta), 5))
            z[index] = delta / np.maximum(sigma, 1e-12)
        z_planes.append(z[t-y0:b-y0, l-x0:r-x0])
    return z_planes


def constant_keep(rgb, model, controls, edges, core):
    """Adapt the earlier equal-energy control to the fixed area and actual frame edges."""
    variance = adaptive._noise_variance(rgb @ adaptive.ACESCG_LUMINANCE, model, edges)
    current = rgb @ adaptive.OPPONENT.T
    result = np.zeros_like(current)
    for level in range(adaptive.LEVELS):
        smooth = adaptive._atrous(current, level, edges)
        band = current - smooth
        energy = adaptive._box(band * band, adaptive.WIENER_RADIUS)
        for c in range(3):
            strength = controls.strengths()[int(c > 0)] * controls.size_multiplier(level)
            if level < 2:
                strength *= controls.fine_band_multiplier()
            noise = np.float32((strength * model.band_sigmas[c][level])**2) * variance
            e = energy[..., c]
            gain = np.maximum(e - noise, 0) / np.maximum(e, np.float32(1e-20))
            if level < 2:
                gain = np.maximum(gain, controls.fine_band_floor())
            channel = band[..., c]
            power = np.sum(np.square(channel[core], dtype=np.float64))
            kept = np.sum(np.square((channel * gain)[core], dtype=np.float64))
            factor = np.sqrt(kept / power) if power else 0.
            result[..., c] += np.float32(factor) * channel
        current = smooth
    return (result + current) @ adaptive.OPPONENT


def classify(mark, stages, z, rect):
    sx, sy = mark["sensor_x"], mark["sensor_y"]
    x, y = locate(stages["baseline"], sx-rect[0], sy-rect[1])
    reference, _ = ring(stages["baseline"], x, y)
    luma, gm, rb = stages["baseline"][y, x] - reference
    chroma = np.hypot(gm, rb)
    direction = np.array([gm, rb], np.float32) / max(float(chroma), 1e-12)
    luma_sign = 1 if luma >= 0 else -1
    records = {key: readings(image, x, y, direction, luma_sign) for key, image in stages.items()}
    now = records["baseline"]
    # Use prominence over the surrounding grain to choose the dominant component.
    # This describes the footprint; colour and brightness are still scored separately.
    colour_led = now["colour_score"] >= now["luma_score"]
    score = "colour_score" if colour_led else "luma_score"
    axis = np.r_[0., direction] if colour_led else np.array([luma_sign, 0., 0.])
    excursion = chroma if colour_led else abs(luma)
    grain = now["colour_grain" if colour_led else "luma_grain"]
    pixels, open_footprint = footprint(stages["baseline"], x, y, axis, max(.5*excursion, 2*grain), reference)

    # Approximate Bayer support of the demosaiced location, post-clamp as well as original.
    patch = np.s_[max(0, y-2):y+3, max(0, x-2):x+3]
    raw_counts = [int(np.count_nonzero(np.abs(image[patch]) >= 4)) for image in z]
    z_max = [float(np.max(np.abs(image[patch]))) for image in z]
    before, after, control = (records[key][score] for key in ("tamed", "baseline", "constant"))
    prior = np.array([records["tamed"][key] for key in ("green_magenta", "red_blue")])
    flip = now["colour_score"] >= 2 and float(prior @ direction) <= -max(DISPLAY_FLOOR, .25*chroma)
    survivor = before >= 1 and after >= 2 and after >= 1.25*before and control <= .75*after
    late = before < 1 and after >= 2
    if flip:
        signature = "colour reversal"
    elif survivor:
        signature = "keep-map survivor"
    elif late:
        signature = "emerged after Denoise"
    elif before >= 1:
        signature = "pre-existing with sensor outlier" if raw_counts[1] else "pre-existing without sensor outlier"
    else:
        signature = "weak or ambiguous"
    if chroma < 2 * now["colour_grain"]:
        hue = "weak colour"
    elif abs(gm) >= abs(rb):
        hue = "green" if gm > 0 else "magenta"
    else:
        hue = "redward" if rb > 0 else "blueward"
    return dict(mark=mark, peak_xy=[x+rect[0], y+rect[1]], colour_direction=direction.tolist(),
                luma_sign=luma_sign, footprint_pixels=pixels, footprint_open=open_footprint,
                colour_led=colour_led, hue=hue, origin_signature=signature,
                colour_reversal=bool(flip), keep_map_survivor=bool(survivor), late=bool(late),
                raw_4sigma_counts=raw_counts, raw_abs_z_max=z_max, stages=records)


def develop_inputs(path, areas):
    with rawpy.RawPy() as raw:
        raw.open_file(str(path))
        flip = raw.sizes.flip
    noisy, _ = marking.develop(path, cleanup=False)
    view = marking.sensor_view(noisy, flip)
    h, w = view.shape[:2]
    crops = {area["id"]: acescg_to_linear_srgb(crop(view, rectangle(area, w, h))) for area in areas}
    ev = marking.exposure_lift(crops, areas)
    tiny_scale = 240 / max(noisy.shape[:2])
    tiny = cv2.resize(noisy, tuple(round(n*tiny_scale) for n in noisy.shape[1::-1]), interpolation=cv2.INTER_AREA)
    return noisy, flip, w, h, ev, tiny


def characterize(output):
    areas, source = inputs()
    identities = {row["name"]: row["sha256"] for row in manifest_files()}
    result = dict(area_hash=sha256(marking.AREAS), marks_hash=sha256(MARKS), photos={})
    for file, fixed in areas.items():
        path = photo_root() / file
        if sha256(path) != identities[file]:
            raise ValueError(f"Wrong original: {file}")
        noisy, flip, w, h, ev, _ = develop_inputs(path, fixed)
        marks = [mark for mark in source["marks"] if mark["file"] == file]
        photo = result["photos"][file] = dict(sha256=identities[file], lift=ev, marks=[], size=[w,h])
        if not marks:
            print(f"{file}: no marks", flush=True)
            continue
        noisy_crops = {area["id"]: display_axes(crop(marking.sensor_view(noisy, flip),
                                                   rectangle(area, w, h, PAD)), ev)
                       for area in fixed if any(mark["area_id"] == area["id"] for mark in marks)}
        del noisy
        tamed, _ = marking.develop(path, cleanup=True)
        model = adaptive.estimate_adaptive_model(tamed, workers=1)
        with rawpy.imread(str(path)) as raw:
            sensor = raw.raw_image_visible
            fit = raw_pixel_cleanup.configuration(sensor, raw_import._camera_linear_metadata_from_libraw(raw))
            for area in fixed:
                group = [mark for mark in marks if mark["area_id"] == area["id"]]
                if not group:
                    continue
                rect = rectangle(area, w, h, PAD)
                rgb, edges = region(tamed, rect, w, h, flip)
                ol, ot, oright, ob = oriented_rect(rectangle(area, w, h), w, h, flip)
                pl, pt, _, _ = oriented_rect(rect, w, h, flip)
                core = np.s_[ot-pt:ob-pt, ol-pl:oright-pl]
                today = adaptive._filter_region(rgb, model, marking.CONTROLS, edges)
                control = constant_keep(rgb, model, marking.CONTROLS, edges, core)
                stages = dict(noisy=noisy_crops[area["id"]],
                              tamed=display_axes(marking.sensor_view(rgb, flip), ev),
                              baseline=display_axes(marking.sensor_view(today, flip), ev),
                              constant=display_axes(marking.sensor_view(control, flip), ev))
                z = sensor_patch(sensor, fit, rect)
                photo["marks"].extend(classify(mark, stages, z, rect) for mark in group)
        del tamed
        print(file, Counter(row["hue"] for row in photo["marks"]),
              Counter(row["origin_signature"] for row in photo["marks"]), flush=True)
    if sum(len(p["marks"]) for p in result["photos"].values()) != len(source["marks"]):
        raise ValueError("At least one mark was not scored")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(marking.json_text(result))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT.parent / "colour-speck-attribution.json")
    args = parser.parse_args()
    cv2.setNumThreads(1)
    characterize(args.output)


if __name__ == "__main__":
    main()
