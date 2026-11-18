"""Same-site intervention on the production CPU Denoise keep factors. Research only."""
import argparse
from dataclasses import asdict
import json
from pathlib import Path

import cv2
import numpy as np
import rawpy

from tools.denoise_eval import metrics
from tools.lib.test_photos import manifest_files, photo_root, sha256
from hdr_finisher import denoise_adaptive as adaptive
from hdr_finisher import raw_import, raw_pixel_cleanup, raw_speck_cleanup, signed_raw

CANON = "IMG_0790.CR2"
EXTRA = ("DSC00512.ARW", "DSC00786.ARW", "DSC05622.ARW", "PA310516.ORF", "PC131157.ORF")
# Original gallery 512px sensor-window origins and its +4 EV display for both.
CANON_WINDOWS = [(4064, 2164), (600, 1500)]
CANON_ZOOMS = [(149, 119), (179, 232)]  # Prior gallery coordinates within the 288px core.
CORE = np.s_[112:400, 112:400]
OFFSETS = np.arange(-12, 13)
DY, DX = np.meshgrid(OFFSETS, OFFSETS, indexing="ij")
ANNULUS = (DY**2 + DX**2 >= 6**2) & (DY**2 + DX**2 <= 12**2)
RY, RX = DY[ANNULUS], DX[ANNULUS]


def window_reader(raw, camera, cleanup):
    sensor = raw.raw_image_visible
    pattern = camera.raw_pattern
    matrix = raw_import._ahd_lab_matrix(raw)

    def read(top, left, bottom, right):
        # Include context for the sensor clamp and AHD, keeping the CFA phase.
        y, x = max(0, top - 40) // 2 * 2, max(0, left - 40) // 2 * 2
        crop = sensor[y:bottom+40, x:right+40].copy()
        if cleanup is not None:
            raw_speck_cleanup.apply(crop, cleanup, 2.5)
        rgb = signed_raw.demosaic(crop, camera.raw_channel_to_rgb[pattern],
                                  camera.raw_black_level[pattern], matrix)
        rgb = raw_import._normalize_camera_rgb_float32(rgb, camera)
        rgb = raw_import._camera_rgb_to_acescg_float32(rgb, camera)
        return rgb[top-y:bottom-y, left-x:right-x].copy()

    return read


def equal_energy_control(rgb, model, controls):
    """Keep the same band/component RMS on the scored core, but spatially constant gain."""
    edges = adaptive._Edges(True, True, True, True, *rgb.shape[:2])
    variance = adaptive._noise_variance(rgb @ adaptive.ACESCG_LUMINANCE, model, edges)
    current = rgb @ adaptive.OPPONENT.T
    adaptive_sum = np.zeros_like(current)
    constant_sum = np.zeros_like(current)
    levels = []
    for level in range(adaptive.LEVELS):
        smooth = adaptive._atrous(current, level, edges)
        band = current - smooth
        energy = adaptive._box(band * band, adaptive.WIENER_RADIUS)
        constants = []
        for c in range(3):
            strength = controls.strengths()[int(c > 0)] * controls.size_multiplier(level)
            if level < 2:
                strength *= controls.fine_band_multiplier()
            noise = np.float32((strength * model.band_sigmas[c][level])**2) * variance
            gain = np.maximum(energy[..., c] - noise, 0) / np.maximum(energy[..., c], np.float32(1e-20))
            if level < 2:
                gain = np.maximum(gain, controls.fine_band_floor())
            source = band[..., c]
            kept = source * gain
            power = np.sum(np.square(source[CORE], dtype=np.float64))
            constant = np.sqrt(np.sum(np.square(kept[CORE], dtype=np.float64)) / power) if power else 0.
            constants.append(float(constant))
            constant_sum[..., c] += np.float32(constant) * source
            adaptive_sum[..., c] += kept
        levels.append(constants)
        current = smooth
    today = adaptive.resolve_adaptive(rgb, model, controls)
    copied = (adaptive_sum + current) @ adaptive.OPPONENT
    # Same arithmetic as the production CPU filter. Fail closed on any drift.
    if not np.array_equal(copied[CORE], today[CORE]):
        raise AssertionError("Instrumented keep factors differ from production on the scored pixels")
    return today, (constant_sum + current) @ adaptive.OPPONENT, levels


def display_residual(rgb, ev):
    shown = metrics.display(rgb * np.float32(2**ev)).astype(np.float32)
    return np.stack([shown[..., c] - cv2.medianBlur(shown[..., c], 5) for c in range(3)], -1)


def peak_sites(residual):
    # Original gallery union detector and exclusions. Choose one peak per component.
    mag = np.abs(residual[CORE])
    score = np.maximum((mag @ metrics.LUMA) / .05, mag.max(-1) / .10)
    mask = (score > 1).astype(np.uint8)
    mask[:6] = mask[-6:] = mask[:, :6] = mask[:, -6:] = 0
    _, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    sites = []
    for label, (x, y, w, h, area) in enumerate(stats[1:], 1):
        if area > 25:
            continue
        box = np.s_[y:y+h, x:x+w]
        dy, dx = np.unravel_index(np.argmax(np.where(labels[box] == label, score[box], -1)), (h, w))
        sites.append((int(y + dy + 112), int(x + dx + 112)))
    return sites


def score_sites(sites, residuals, *, record_sites=False):
    # Keep the signed RGB channel selected on today's output fixed across conditions.
    # Negative values after projection flag polarity reversal.
    today = residuals[1]
    results = []
    observations = []
    for y, x in sites:
        c = np.argmax(np.abs(today[y, x]))
        sign = np.sign(today[y, x, c])
        values = []
        for residual in residuals:
            amplitude = sign * residual[y, x, c]
            ring = np.median(np.abs(residual[y+RY, x+RX, c]))
            values.append(float(amplitude / max(.01, ring)))
        results.append(values)
        if record_sites:
            observations.append([x - 112, y - 112, int(c), int(sign), *[round(v, 4) for v in values]])
    scores = np.array(results).reshape(-1, 3)
    src, post, control = scores.T
    # At least 25% separation is a descriptive effect size, not a quality tolerance.
    same = src > 0
    stronger = post >= 1.25 * src
    depends = control <= .75 * post
    summary = dict(n=len(sites), pre_same_sign=int(same.sum()),
                more_isolated=int((same & stronger).sum()),
                map_sensitive=int(depends.sum()),
                combined={str(p): int((same & (post >= (1+p)*src) & (control <= (1-p)*post)).sum())
                          for p in (.15, .25, .35)},
                combined_pre_score_at_least_one=int(((src >= 1) & stronger & depends).sum()),
                median_scores=np.median(scores, axis=0).tolist() if sites else None)
    if record_sites:
        summary["sites_xy_channel_sign_input_today_constant"] = observations
    return summary


def fixed_zoom(conditions, ev, xy):
    """Independent point chosen for the old gallery. Positive GM denotes green."""
    x, y = (v + 112 for v in xy)
    readings = []
    for rgb in conditions:
        shown = metrics.display(rgb * np.float32(2**ev))
        gm = shown[..., 1] - .5 * (shown[..., 0] + shown[..., 2])
        luma = shown @ metrics.LUMA
        readings.append([float(channel[y, x] - np.median(channel[y+RY, x+RX]))
                         for channel in (gm, luma)])
    return dict(xy=xy, gm_luma_minus_ring_median=readings)


def measure(path, identity):
    with rawpy.imread(str(path)) as raw:
        sensor = raw.raw_image_visible
        camera = raw_import._camera_linear_metadata_from_libraw(raw)
        height, width = sensor.shape
        windows = CANON_WINDOWS if path.name == CANON else [
            ((width - 512) // 4 * 2, (height - 512) // 4 * 2)]
        ev = 4 if path.name == CANON else 0
        rows = []
        for taming in ((False, True) if path.name == CANON else (True,)):
            config = raw_pixel_cleanup.configuration(sensor, camera) if taming else None
            if taming and config is None:
                raise ValueError(f"Missing sensor noise fit for {path.name}")
            read = window_reader(raw, camera, config)
            model = adaptive.estimate_adaptive_model_from_windows(height, width, read, workers=1)
            for left, top in windows:
                source = read(top, left, top+512, left+512)
                controls = adaptive.AdaptiveControls()
                current, control, constants = equal_energy_control(source, model, controls)
                residuals = [display_residual(condition, ev) for condition in (source, current, control)]
                peaks = [peak_sites(residual) for residual in residuals]
                # Repeat at input-selected sites to expose output-selection bias.
                rows.append(dict(origin_xy=[left, top], lift_ev=ev, taming=taming,
                                 sensor_fit=config, model=model.as_dict(), band_constant_gains=constants,
                                 islands=[len(group) for group in peaks],
                                 post_selected=score_sites(peaks[1], residuals, record_sites=(path.name == CANON)),
                                 pre_selected=score_sites(peaks[0], residuals)))
                if path.name == CANON:
                    zoom = CANON_ZOOMS[CANON_WINDOWS.index((left, top))]
                    rows[-1]["frozen_zoom"] = fixed_zoom((source, current, control), ev, zoom)
    return dict(file=path.name, sha256=identity, rows=rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    entries = {row["name"]: row for row in manifest_files()}
    result = dict(measurement=adaptive.MEASUREMENT_VERSION, controls=asdict(adaptive.AdaptiveControls()),
                  island_order=["input", "today", "constant"], files=[])
    cv2.setNumThreads(1)
    for name in (CANON, *EXTRA):
        path = photo_root() / name
        identity = sha256(path)
        if identity != entries[name]["sha256"]:
            raise ValueError(f"Source differs from manifest: {name}")
        print(name, flush=True)
        result["files"].append(measure(path, identity))
    args.output.parent.mkdir(exist_ok=True, parents=True)
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
