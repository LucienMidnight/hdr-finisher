"""CPU observations for the GPU measurement's fast, host-only contract check."""
import json
import numpy as np
from hdr_finisher import denoise_adaptive as adaptive


def fixtures():
    generator = np.random.default_rng(904)
    for name, signal in (("ordinary", .1), ("flame", .01), ("signed flame", .0002), ("noiseless", 0)):
        image = generator.normal(signal, .005, (128, 128, 3)).astype(np.float32)
        if name != "ordinary":
            image[:, :64] = 1.25
        if name == "noiseless":
            image[:, 64:] = 0
        observations, eligible = adaptive._variance_observations(image, adaptive._sample_tiles(128, 128))
        spreads = generator.uniform(.8, 1.2, eligible.size)
        spreads[~eligible] = 0
        informed = eligible.sum() >= adaptive.CALIBRATION_RULES["min_blocks"]
        selected = (adaptive._calibration_blocks(spreads, eligible) if informed
                    else spreads <= np.quantile(spreads, adaptive.FLAT_BLOCK_QUANTILE))
        shape = adaptive._fit_informative_variance(observations)
        yield dict(name=name, observations=observations, spreads=spreads.tolist(),
                   zero_fractions=np.where(eligible, 0., 1.).tolist(), informed=bool(informed),
                   selected=np.flatnonzero(selected).tolist(),
                   model=None if shape is None else dict(zip(("a", "b", "c"), shape)))


def fits():
    for signals in ([.01], [.01, .01], [.001, .01], [.001, .003, .01, .03, .1]):
        for scale in (1/64, 1, 64):
            observations = [dict(signal=signal*scale, variance=(.003*signal+2e-6)*scale**2,
                                 pixels=1000, zero_fraction=0.) for signal in signals]
            model = adaptive._fit_informative_variance(observations)
            yield dict(observations=observations, model=dict(zip(("a", "b", "c"), model)))


print(json.dumps(dict(version=adaptive.MEASUREMENT_VERSION, rules=adaptive.CALIBRATION_RULES,
                     fixtures=list(fixtures()), fits=list(fits()))))
