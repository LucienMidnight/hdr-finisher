"""Compare finished grain statistics with the pre-F1 Poisson model.

Run from codebase with the venv Python. This uses flat SDR patches, not photo
crops, to measure the grain itself after each stock's density development.
The old code is loaded from Git only for this offline comparison.
"""
from __future__ import annotations

import argparse
import csv
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from hdr_finisher import adjustments, film_grain, film_stock  # noqa: E402
from hdr_finisher.models import FilmLookAdjustments, PreviewKind  # noqa: E402

BASELINE = "aee3d656"
FRAME_SIZES = {"IMG_7723.CR3": (6024, 4020), "DSC00636.ARW": (8660, 5784)}
TONES = (0.005, 0.04, 0.18, 0.9)
LUMA = np.float64([0.2126, 0.7152, 0.0722])
KIND = PreviewKind.SDR
FULL = np.float32(1)


def load_baseline(revision):
    source = subprocess.check_output(
        ["git", "show", f"{revision}:codebase/backend/hdr_finisher/film_grain.py"], encoding="utf-8")
    module = ModuleType("hdr_finisher._grain_calibration_baseline")
    sys.modules[module.__name__] = module
    exec(compile(source, f"{revision}/film_grain.py", "exec"), module.__dict__)
    return module


def statistics(image, clean, bins, taper):
    safe_log = lambda a: np.log2(np.maximum(a, 1e-8))  # noqa: E731
    diff = safe_log(image @ LUMA) - safe_log(clean @ LUMA)
    centre = diff - diff.mean()
    rms = float(np.sqrt(np.mean(centre * centre)))
    power = np.abs(np.fft.fft2(centre * taper)) ** 2
    power[0, 0] = 0.0
    spectrum = np.bincount(bins.ravel(), weights=power.ravel(), minlength=33)
    d = safe_log(image) - safe_log(clean)
    chroma = np.std(np.stack((d[..., 0] - d[..., 1], d[..., 2] - d[..., 1]), -1), axis=(0, 1))
    return {
        "mean_stops": float(diff.mean()),
        "rms_stops": rms,
        "span_p05_p95_stops": float(np.percentile(diff, 95) - np.percentile(diff, 5)),
        "skew": float(np.mean((centre / max(rms, 1e-8)) ** 3)),
        "half_power_cycles_per_pixel": float(np.searchsorted(np.cumsum(spectrum), spectrum.sum() * 0.5) / 64),
        "fine_power_share": float(spectrum[19:].sum() / max(spectrum.sum(), 1e-18)),
        "neighbor_corr": float((np.mean(centre[1:] * centre[:-1]) + np.mean(centre[:, 1:] * centre[:, :-1]))
                               / max(2 * rms**2, 1e-18)),
        "chroma_rms_stops": float(np.hypot(*chroma) / np.sqrt(2.0)),
        **{f"power_{i:02}": float(band / max(spectrum.sum(), 1e-18)) for i, band in enumerate(spectrum)},
    }


def patches(args):
    baseline = load_baseline(args.baseline)
    stocks = args.stock or film_stock.FILM_STOCK_IDS
    n = args.patch
    frequencies = np.fft.fftfreq(n)
    bins = np.minimum(32, (64 * np.hypot(frequencies[:, None], frequencies[None, :])).astype(int))
    taper = np.outer(np.hanning(n), np.hanning(n))
    for photo in args.photo or FRAME_SIZES:
        width, height = FRAME_SIZES[photo]
        for fit in (True, False):
            scale = args.fit_edge / width if fit else 1.0
            w, h = round(width * scale), round(height * scale)
            window = adjustments.FrameWindow((w - n) // 2, (h - n) // 2, w, h)
            for size in args.size:
                for style, selected in (("color_negative", ["none", *stocks]), ("black_and_white", ["none"])):
                    if args.film_type and args.film_type != style:
                        continue
                    look = FilmLookAdjustments(grain_amount=60, grain_size=size, grain_chroma=40,
                                              grain_softness=25, grain_film_type=style)
                    for tone in TONES:
                        card = np.full((n, n, 3), tone, dtype=np.float32)
                        for label, engine in (("old", baseline), ("new", film_grain)):
                            adjustments.film_grain = engine
                            try:
                                variant = look.model_copy(update={"film_stock": "none"})
                                density = adjustments._apply_density_grain(
                                    card, variant, KIND, 731823, FULL, density_delta=True,
                                    frame_window=window, preview_scale=scale)
                            finally:
                                adjustments.film_grain = film_grain
                            for stock in selected:
                                clean, image = card.copy(), card.copy()
                                if stock == "none":
                                    image *= np.exp2(density / np.float32(-np.log10(2.0)))
                                else:
                                    render = adjustments._film_stock_renderer(
                                        look.model_copy(update={"film_stock": stock}), KIND, FULL)
                                    if render is None:
                                        raise ValueError(f"Missing Film Stock: {stock}")
                                    render(clean.reshape(-1, 3), None)
                                    render(image.reshape(-1, 3), density.reshape(-1, 3))
                                yield {"photo": photo, "zoom": "Fit" if fit else "100%", "frame_width": w,
                                       "frame_height": h, "scale": scale, "patch": n,
                                       "stock": stock, "size": size, "tone_scene_linear": tone,
                                       "film_type": style, "field": label, "baseline": args.baseline,
                                       **statistics(image, clean, bins, taper)}
                print(f"{photo} {'Fit' if fit else '100%'} Size {size}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", default=BASELINE)
    parser.add_argument("--fit-edge", default=1283, type=int)
    parser.add_argument("--patch", default=128, type=int)
    parser.add_argument("--stock", nargs="+", help="Use only the named stock ids, plus the neutral control")
    parser.add_argument("--film-type", choices=("color_negative", "black_and_white"))
    parser.add_argument("--size", default=[0, 30, 50, 100], nargs="+", type=int)
    parser.add_argument("--photo", choices=tuple(FRAME_SIZES), action="append")
    parser.add_argument("--output", type=Path, default=Path("output/f1-grain/calibration.csv"))
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8") as stream:
        writer = None
        for row in patches(args):
            if writer is None:
                writer = csv.DictWriter(stream, tuple(row))
                writer.writeheader()
            writer.writerow(row)
            stream.flush()


if __name__ == "__main__":
    main()
