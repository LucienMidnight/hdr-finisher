"""Single-photo, bright-only Bayer cleanup experiment; not production code."""
from __future__ import annotations

from dataclasses import dataclass
import numpy as np

from hdr_finisher.denoise_adaptive import resolve_adaptive
from tools.denoise_eval.candidates.denoise_v2_appdefault import AppDefault
from tools.denoise_eval.candidates.pixel_cleanup import noise_positions
from tools.denoise_eval.inputs import develop

HOT_SIGMA = 8.
LIGHT_SIGMA = 2.5
MINIMUM_EXCESS = .02
CLIP_GUARD = .98
HALO = 4
STRIP_ROWS = 256
OFFSETS = ((-2, -2), (-2, 0), (-2, 2), (0, -2),
           (0, 2), (2, -2), (2, 0), (2, 2))
DIRECTIONS = ((0, 2), (2, 0), (2, 2), (2, -2))


def _profile(metadata):
    parameters = noise_positions(metadata)
    pattern = np.asarray(metadata.get('cfa'))
    raw_pattern = np.asarray(metadata.get('raw_cfa', metadata.get('cfa')))
    black = np.asarray(metadata.get('black_levels', ()), dtype=float)
    white = np.asarray(metadata.get('white_levels', ()), dtype=float)
    if (parameters is None or pattern.shape != (2, 2) or raw_pattern.shape != (2, 2)
            or sorted(pattern.ravel().tolist()) != [0, 1, 1, 2]
            or not np.isin(raw_pattern, [0, 1, 2, 3]).all()
            or black.shape != (4,) or white.shape != (4,)
            or not np.isfinite(black).all() or not np.isfinite(white).all()
            or np.any(white <= black)):
        return None
    spans = (white - black)[raw_pattern.astype(int)].ravel()
    return parameters, pattern, 1 / spans


def filter_sensor(mosaic, metadata, *, enabled=True, cold=False):
    """Inspect unchanged signed, black-subtracted/white-normalised samples.

    Compare each phase with all eight same-phase neighbours. An immediate
    other-colour rise vetoes repair; its baseline comes from that site's own
    phase. Read noise, shot noise at the observed signal and DN quantisation
    enter both comparisons. Clipped centres/context and a four-pixel border
    are preserved. Repairs never become neighbours for later decisions.
    """
    image = np.asarray(mosaic, dtype=np.float32)
    if image.ndim != 2 or not np.isfinite(image).all():
        raise ValueError('Expected finite, signed, normalised Bayer samples')
    if cold:
        raise ValueError('Cold-pixel discovery is unqualified and disabled')
    origin = metadata.get('tile_origin', (0, 0))
    if len(origin) != 2 or any(int(value) != value or value % 2 for value in origin):
        raise ValueError('Bayer window origin must preserve the even sensor phase')
    result = image.copy()
    diagnostics = dict(status='disabled' if not enabled else 'unsupported',
                       proposed=0, repaired=0, light_veto=0, clipping_veto=0,
                       changed=[], protected_light=[], cold_enabled=False,
                       classification='single-frame candidates, not proven sensor defects')
    profile = _profile(metadata)
    if not enabled or profile is None or min(image.shape) < 2 * HALO + 1:
        return result, diagnostics
    parameters, pattern, steps = profile
    diagnostics['status'] = 'measured'
    height, width = image.shape
    for top in range(HALO, height - HALO, STRIP_ROWS):
        bottom = min(height - HALO, top + STRIP_ROWS)
        for phase, (shot, read) in enumerate(parameters):
            row_phase, column_phase = divmod(phase, 2)
            first_row = top + (row_phase - top) % 2
            first_column = HALO + (column_phase - HALO) % 2
            rows = slice(first_row, bottom, 2)
            columns = slice(first_column, width - HALO, 2)
            centre = image[rows, columns]
            if not centre.size:
                continue
            largest = np.full_like(centre, -np.inf)
            for delta_row, delta_column in OFFSETS:
                neighbour = image[first_row + delta_row:bottom + delta_row:2,
                                  first_column + delta_column:width - HALO + delta_column:2]
                np.maximum(largest, neighbour, out=largest)
            variance = shot * np.maximum(centre, 0) + read + steps[phase] ** 2 / 12
            proposed = centre - largest > np.maximum(HOT_SIGMA * np.sqrt(variance), MINIMUM_EXCESS)
            diagnostics['proposed'] += int(proposed.sum())
            for local_row, local_column in zip(*np.nonzero(proposed)):
                row = first_row + 2 * int(local_row)
                column = first_column + 2 * int(local_column)
                value = float(image[row, column])
                if np.max(image[row-2:row+3, column-2:column+3]) >= CLIP_GUARD:
                    diagnostics['clipping_veto'] += 1
                    continue
                light = False
                strongest_support = 0.
                for delta_row in (-1, 0, 1):
                    for delta_column in (-1, 0, 1):
                        neighbour_row, neighbour_column = row + delta_row, column + delta_column
                        support_phase = 2 * (neighbour_row % 2) + neighbour_column % 2
                        if pattern[neighbour_row % 2, neighbour_column % 2] == pattern[row_phase, column_phase]:
                            continue
                        support = float(image[neighbour_row, neighbour_column])
                        background = float(np.median([
                            image[neighbour_row + offset_row, neighbour_column + offset_column]
                            for offset_row, offset_column in OFFSETS]))
                        support_shot, support_read = parameters[support_phase]
                        support_sigma = np.sqrt(support_shot * max(support, background, 0)
                                                + support_read + steps[support_phase] ** 2 / 12)
                        rise = support - background
                        strongest_support = max(strongest_support, rise / max(support_sigma, 1e-12))
                        if rise > max(LIGHT_SIGMA * support_sigma, 2 * steps[support_phase]):
                            light = True
                if light:
                    diagnostics['light_veto'] += 1
                    if len(diagnostics['protected_light']) < 24:
                        diagnostics['protected_light'].append(dict(
                            y=row + int(origin[0]), x=column + int(origin[1]),
                            value=value, other_colour_rise_sigma=strongest_support))
                    continue
                pairs = [(float(image[row-delta_row, column-delta_column]),
                          float(image[row+delta_row, column+delta_column]))
                         for delta_row, delta_column in DIRECTIONS]
                first, second = min(pairs, key=lambda pair: abs(pair[0] - pair[1]))
                replacement = .5 * (first + second)
                result[row, column] = replacement
                diagnostics['changed'].append(dict(
                    y=row + int(origin[0]), x=column + int(origin[1]), phase=phase,
                    value=value, replacement=replacement,
                    excess_sigma=float((value-largest[local_row, local_column]) /
                                       np.sqrt(variance[local_row, local_column])),
                    other_colour_rise_sigma=strongest_support))
    diagnostics['repaired'] = len(diagnostics['changed'])
    return result, diagnostics


@dataclass
class Prepared:
    rgb: np.ndarray
    model: object
    diagnostics: dict


class HotPixel:
    input_kind = 'bayer'
    margin = 90
    supports_alpha = False
    supports_bypass = True

    def __init__(self, denoise=False):
        self.denoise = denoise

    def prepare(self, image, metadata):
        repaired, diagnostics = filter_sensor(image, metadata)
        rgb = develop(repaired, metadata)
        model = AppDefault().prepare(rgb, metadata) if self.denoise else None
        return Prepared(rgb, model, diagnostics)

    def process(self, image, metadata, state, *, bypass=False):
        if bypass:
            return develop(image, metadata)
        if 'tile_origin' in metadata or image.shape != state.rgb.shape[:2]:
            repaired, _ = filter_sensor(image, metadata)
            rgb = develop(repaired, metadata)
        else:
            rgb = state.rgb.copy()
        return resolve_adaptive(rgb, state.model, AppDefault().controls) if self.denoise else rgb

    def description(self):
        return dict(algorithm='single-photo-hot-pixel-research', input_kind='bayer',
                    denoise=self.denoise, cold=False, hot_sigma=HOT_SIGMA,
                    light_sigma=LIGHT_SIGMA, minimum_excess=MINIMUM_EXCESS,
                    clipping_guard=CLIP_GUARD, halo=HALO,
                    placement='normalised signed sensor, before Opposed color and demosaic',
                    controls=AppDefault().description()['controls'] if self.denoise else None)


def alone():
    return HotPixel()


def with_denoise():
    return HotPixel(denoise=True)
