"""Pixel cleanup: calibration-backed sensor-defect repair, never scene denoising.

Single-frame candidates are diagnostic, not proof of a broken photosite. Only
coordinates from an independently confirmed sensor map can change the mosaic.
All coordinates are in the visible, unrotated sensor, before white balance.
"""
from __future__ import annotations

from dataclasses import dataclass
import numpy as np

from tools.denoise_eval.inputs import develop
from tools.denoise_eval.candidates.denoise_v2_appdefault import AppDefault
from hdr_finisher.denoise_adaptive import resolve_adaptive

SIGMA = 12.
MINIMUM_EXCURSION = .02
MARGIN = 4


def noise_positions(metadata):
    parameters = metadata.get('noise_parameters') or metadata.get('noise_fit_positions')
    if not parameters or len(parameters) != 4 or any(item is None for item in parameters):
        return None
    result = np.asarray([[item['a'], item['b']] for item in parameters], dtype=np.float64)
    if not np.isfinite(result).all() or np.any(result < 0) or np.any(result.sum(1) <= 0):
        return None
    return result


def candidate_samples(mosaic, metadata, *, calibration=False):
    """Conservative >12-sigma same-plane anomalies, *not* confirmed defects.

    Eight same-phase neighbours exclude the centre. Large local ranges reject
    edges. Clipped samples and borders are never automatically classified.
    Noise uses max(observed, predicted) signal, avoiding a shadow-only shot
    variance that would dramatically overstate positive excursions.
    """
    image = np.asarray(mosaic, dtype=np.float32)
    if image.ndim != 2 or not np.isfinite(image).all():
        raise ValueError('Expected a finite, normalised Bayer sensor mosaic')
    parameters = noise_positions(metadata)
    if parameters is None:
        return dict(status='uncalibrated', candidates=[], planes=[])
    origin = metadata.get('tile_origin', (0, 0))
    if origin[0] % 2 or origin[1] % 2:
        raise ValueError('Bayer window origin must preserve the even sensor phase')
    records, planes = [], []
    for phase, (shot, read) in enumerate(parameters):
        row_phase, column_phase = divmod(phase, 2)
        plane = image[row_phase::2, column_phase::2]
        if min(plane.shape) < 5:
            continue
        centre = plane[1:-1, 1:-1]
        neighbours = np.stack([plane[1+row:plane.shape[0]-1+row,
                                          1+column:plane.shape[1]-1+column]
                               for row, column in ((-1,-1),(-1,0),(-1,1),
                                                   (0,-1),(0,1),(1,-1),(1,0),(1,1))])
        prediction = np.median(neighbours, axis=0)
        sigma = np.sqrt(shot*np.maximum(np.maximum(centre, prediction), 0) + read + (1/65535)**2/12)
        residual = centre-prediction
        scores = np.abs(residual)/np.maximum(sigma, 1e-12)
        local_range = np.max(neighbours, axis=0)-np.min(neighbours, axis=0)
        context_sigma = np.sqrt(shot*np.maximum(prediction, 0)+read+(1/65535)**2/12)
        eligible = ((scores > SIGMA) & (np.abs(residual) > MINIMUM_EXCURSION)
                    & (local_range < 6*context_sigma)
                    & ((centre < 1) | calibration) & (np.max(neighbours, axis=0) < .98))
        eligible[[0,-1],:] = False
        eligible[:,[0,-1]] = False
        for row, column in zip(*np.nonzero(eligible)):
            records.append(dict(y=int(2*(row+1)+row_phase+origin[0]),
                                x=int(2*(column+1)+column_phase+origin[1]),
                                phase=phase, value=float(centre[row,column]),
                                prediction=float(prediction[row,column]),
                                sigma_distance=float(scores[row,column]),
                                polarity='hot' if residual[row,column] > 0 else 'cold'))
        planes.append(dict(phase=phase, candidates=int(eligible.sum()),
                           residual_sigma_p999=float(np.percentile(scores,99.9)),
                           above_white=int(np.count_nonzero(plane >= 1)),
                           at_or_below_black=int(np.count_nonzero(plane <= 0))))
    return dict(status='diagnostic_only', candidates=records, planes=planes)


def confirm_calibration(frames, metadata, *, kind, capture_ids):
    """Intersect five or more independent dark/flat calibration exposures.

    Caller must supply the same camera, ISO, temperature regime, exposure and
    visible sensor geometry. Flat frames must be evenly illuminated and moved
    relative to any scene. Science/dataset clean truth must never be supplied.
    Dark frames establish hot/cold offset errors; dead sites need flat frames.
    """
    if kind not in ('dark', 'flat') or len(frames) < 5:
        raise ValueError('Need at least five independent dark or flat calibration frames')
    if len(capture_ids) != len(frames) or len(set(capture_ids)) != len(frames):
        raise ValueError('Calibration needs distinct acquisition IDs, not repeated scene frames')
    if noise_positions(metadata) is None:
        raise ValueError('Calibration requires a valid Poisson–Gaussian noise model')
    shape = np.asarray(frames[0]).shape
    persistent = None
    for frame in frames:
        image = np.asarray(frame, dtype=np.float32)
        if image.shape != shape or image.ndim != 2 or not np.isfinite(image).all():
            raise ValueError('Calibration frames must have identical finite Bayer geometry')
        medians = [float(np.median(image[row::2,column::2])) for row in range(2) for column in range(2)]
        if kind == 'dark' and max(medians) > .02:
            raise ValueError('Dark calibration must be near sensor black')
        if kind == 'flat' and (min(medians) < .05 or max(medians) > .8):
            raise ValueError('Flat calibration must be exposed above black and below clipping')
        found = {(item['y'], item['x'], item['polarity'])
                 for item in candidate_samples(image, metadata, calibration=True)['candidates']}
        persistent = found if persistent is None else persistent & found
    return [dict(y=row, x=column, polarity=polarity, evidence=f'{len(frames)}-{kind}-calibration-frames')
            for row, column, polarity in sorted(persistent)]


def repair_sensor(mosaic, metadata, defects=()):
    """Simultaneous directional interpolation at independently mapped sites only.

    Exclude other defects from support, skip non-isolated maps/borders, and
    never interpolate from clipped neighbours. A mapped saturated hot pixel
    can be repaired only when its surrounding sensor area is unclipped.
    """
    image = np.asarray(mosaic)
    if image.ndim != 2 or not np.issubdtype(image.dtype, np.floating) or not np.isfinite(image).all():
        raise ValueError('Expected a finite floating Bayer sensor mosaic')
    origin = metadata.get('tile_origin', (0, 0))
    if origin[0] % 2 or origin[1] % 2:
        raise ValueError('Bayer window origin must preserve the even sensor phase')
    selected = set()
    for defect in defects:
        if not defect.get('evidence'):
            raise ValueError('Pixel cleanup needs independent sensor-defect evidence')
        if any(not isinstance(defect[key], (int,np.integer)) for key in ('y','x')):
            raise ValueError('Sensor-defect coordinates must be integers')
        selected.add((defect['y']-origin[0], defect['x']-origin[1]))
    result = image.copy()
    changed, skipped = [], []
    height, width = image.shape
    for row, column in sorted(selected):
        if not (0 <= row < height and 0 <= column < width):
            continue
        reason = None
        if not (MARGIN <= row < height-MARGIN and MARGIN <= column < width-MARGIN):
            reason = 'border'
        elif any((row+dy,column+dx) in selected for dy in range(-4,5)
                 for dx in range(-4,5) if dy or dx):
            reason = 'nonisolated_map'
        else:
            context = image[row-4:row+5,column-4:column+5].copy()
            context[4,4] = 0
            if np.max(context) >= .98:
                reason = 'clipped_context'
        if reason:
            skipped.append(dict(y=row+origin[0], x=column+origin[1], reason=reason))
            continue
        pairs = [(image[row-dy,column-dx],image[row+dy,column+dx])
                 for dy,dx in ((0,2),(2,0),(2,2),(2,-2))]
        first,second = min(pairs, key=lambda pair: abs(float(pair[0])-float(pair[1])))
        replacement = (float(first)+float(second))*.5
        result[row,column] = replacement
        if result[row,column] != image[row,column]:
            changed.append(dict(y=row+origin[0],x=column+origin[1]))
    return result, dict(name='Pixel cleanup', mapped=len(selected), repaired=len(changed),
                        changed=changed, skipped=skipped,
                        classification='independent calibration only; single-frame suspects are not repaired')


@dataclass
class Prepared:
    mosaic: np.ndarray
    diagnostics: dict
    rgb: np.ndarray
    model: object


class PixelCleanup:
    input_kind = 'bayer'
    margin = 86
    supports_alpha = False
    supports_bypass = True

    def __init__(self, denoise=False):
        self.denoise = denoise

    def prepare(self, image, metadata):
        value, diagnostics = repair_sensor(image, metadata, metadata.get('pixel_cleanup_defects', ()))
        rgb = develop(value, metadata)
        model = AppDefault().prepare(rgb,metadata) if self.denoise else None
        return Prepared(value, diagnostics, rgb, model)

    def process(self, image, metadata, state, *, bypass=False):
        if bypass:
            return develop(image,metadata)
        if image.shape == state.mosaic.shape and 'tile_origin' not in metadata:
            rgb = state.rgb.copy()
        else:
            source,_ = repair_sensor(image,metadata,metadata.get('pixel_cleanup_defects', ()))
            rgb = develop(source, metadata)
        if self.denoise and not bypass:
            rgb = resolve_adaptive(rgb,state.model,AppDefault().controls)
        return rgb

    def description(self):
        return dict(algorithm='Pixel cleanup', input_kind='bayer', denoise=self.denoise,
                    policy='repair independently calibrated defects only',
                    defect_map_source='metadata.pixel_cleanup_defects', single_frame_detection='diagnostic only')

    def state_description(self, state):
        return state.diagnostics


def alone():
    return PixelCleanup()


def with_denoise():
    return PixelCleanup(denoise=True)
