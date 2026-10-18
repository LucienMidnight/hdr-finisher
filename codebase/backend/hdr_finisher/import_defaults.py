"""Neutral import defaults shared by Grade and Library; no image metering."""
import struct
from pathlib import Path

import numpy as np

from .adjustments import SDR_SCENE_TO_DISPLAY_SCALE
from .color_context import scene_linear_to_nits
from .models import AdjustmentState

RAW_CALIBRATION_EV = -0.8


def fuji_raw_exposure_bias(path):
    """Read RAF tag 0x9650, without decoding an image or guessing a DR mode.

    RAF directory layout and signed 16-bit rational: ExifTool FujiFilm.pm.
    Meaning/sign independently documented and tested across DR100/200/400:
    https://docs.darktable.org/lua/stable/lua.scripts.manual/scripts/contrib/fujifilm_dynamic_range/
    A negative bias records a reduction; compensate by its negative in EV.
    Missing, malformed or unsupported metadata receives no compensation.
    """
    if Path(path).suffix.lower() != '.raf':
        return None
    try:
        with Path(path).open('rb') as handle:
            header = handle.read(100)
            if len(header) != 100 or not header.startswith(b'FUJIFILMCCD-RAW '):
                return None
            offset, length = struct.unpack_from('>II', header, 92)
            if offset < 100 or not 4 <= length <= 1024 * 1024:
                return None
            handle.seek(offset)
            directory = handle.read(length)
        if len(directory) != length:
            return None
        count = struct.unpack_from('>I', directory)[0]
        if count >= 256:
            return None
        position = 4
        bias = None
        for _ in range(count):
            tag, size = struct.unpack_from('>HH', directory, position)
            position += 4
            if position + size > length:
                return None
            if tag == 0x9650:
                if size != 4 or bias is not None:
                    return None
                numerator, denominator = struct.unpack_from('>hh', directory, position)
                if denominator <= 0:
                    return None
                bias = numerator / denominator
            position += size
        return bias
    except (OSError, struct.error):
        return None


def calibrate_camera_raw(pixels, path):
    """One uniform linear gain plus explicitly recorded Fuji brightness."""
    bias = fuji_raw_exposure_bias(path)
    recorded_ev = -bias if bias is not None else 0.0
    pixels *= np.float32(2.0 ** (RAW_CALIBRATION_EV + recorded_ev))
    return {'calibration_ev': RAW_CALIBRATION_EV,
            'recorded_brightness_ev': recorded_ev,
            'fuji_raw_exposure_bias_ev': bias}


def apply_import_defaults(adjustments, reference):
    if reference is not None:
        # The SDR base is already an authored rendition.
        adjustments.sdr.highlight_section_enabled = False


def starting_adjustments(analysis, reference=None, white=203):
    adjustments = AdjustmentState()
    apply_import_defaults(adjustments, reference)
    sync_highlight_source_peaks(adjustments, analysis, reference, white)
    return adjustments


def sync_highlight_source_peaks(adjustments, analysis, reference, white):
    hdr = adjustments.hdr
    color_handling = hdr.highlight_compression_color_handling
    grouped_channels = color_handling in {"smooth_rolloff", "path_to_white"}
    robust = hdr.highlight_compression_peak_measurement == "robust"
    if color_handling == "smooth_rolloff":
        measured = analysis.robust_peak_bt2020_linear if robust else analysis.peak_bt2020_linear
    elif grouped_channels:
        measured = analysis.robust_peak_linear if robust else analysis.peak_linear
    else:
        measured = analysis.robust_peak_luma_linear if robust else analysis.peak_luma_linear
    if measured is None:
        measured = analysis.peak_linear
    source_peak_nits = max(1.0, float(scene_linear_to_nits(float(measured), white)))
    hdr.highlight_compression_source_peak_nits = source_peak_nits

    sdr = adjustments.sdr
    if reference is not None and sdr.use_authored_base:
        sdr_measured = float(np.max(np.clip(reference, 0.0, None)))
    else:
        sdr_robust = sdr.highlight_compression_peak_measurement == "robust"
        if sdr.highlight_compression_color_handling == "preserve_color":
            sdr_measured = analysis.robust_peak_luma_linear if sdr_robust else analysis.peak_luma_linear
        else:
            sdr_measured = analysis.robust_peak_linear if sdr_robust else analysis.peak_linear
        if sdr_measured is None:
            sdr_measured = analysis.peak_linear
        sdr_measured = float(sdr_measured) * float(SDR_SCENE_TO_DISPLAY_SCALE)
    sdr.highlight_compression_source_peak_percent = max(1.0, sdr_measured * 100.0)
