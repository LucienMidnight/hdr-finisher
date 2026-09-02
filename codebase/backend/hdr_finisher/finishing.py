from __future__ import annotations

import math
from functools import lru_cache

import numpy as np

from .models import GeometryAdjustments, OutputFinishingSettings, PerspectiveGuideLine, PreviewKind


def apply_geometry(image: np.ndarray, geometry: GeometryAdjustments) -> np.ndarray:
    """Apply the one shared, destructive geometry stage without inventing pixels."""
    crop = geometry.crop
    neutral_crop = crop.x == 0.0 and crop.y == 0.0 and crop.width == 1.0 and crop.height == 1.0
    # Straighten (owned by Crop & Rotate) and perspective_rotate (owned by the
    # guided Perspective correction) are two independently-authored rotations
    # that compose into a single roll, the same way darktable and Lightroom
    # keep their manual straighten and guided-upright rotation separate but
    # apply them as one combined transform.
    total_roll = geometry.straighten_angle + geometry.perspective_rotate
    if (
        geometry.rotation == 0
        and not geometry.flip_horizontal
        and not geometry.flip_vertical
        and total_roll == 0.0
        and geometry.perspective_horizontal == 0.0
        and geometry.perspective_vertical == 0.0
        and neutral_crop
    ):
        return image

    result = image.astype(np.float32, copy=True)
    if geometry.rotation:
        # Persist positive quarter turns as clockwise, matching the editor labels.
        result = np.rot90(result, k=(-geometry.rotation // 90) % 4).copy()
    if geometry.flip_horizontal:
        result = np.flip(result, axis=1).copy()
    if geometry.flip_vertical:
        result = np.flip(result, axis=0).copy()
    if geometry.perspective_horizontal or geometry.perspective_vertical:
        result = _warp_perspective_to_valid_pixels(
            result,
            total_roll,
            geometry.perspective_horizontal,
            geometry.perspective_vertical,
        )
    elif total_roll:
        result = _rotate_to_valid_pixels(result, total_roll)

    height, width = result.shape[:2]
    left = int(np.clip(round(crop.x * width), 0, width - 1))
    top = int(np.clip(round(crop.y * height), 0, height - 1))
    right = int(np.clip(round((crop.x + crop.width) * width), left + 1, width))
    bottom = int(np.clip(round((crop.y + crop.height) * height), top + 1, height))
    return np.ascontiguousarray(result[top:bottom, left:right], dtype=np.float32)


def geometry_coordinate_map(
    width: int,
    height: int,
    geometry: GeometryAdjustments,
) -> tuple[tuple[float, ...], tuple[float, ...], int, int]:
    """Return normalized output/source homographies from the exact geometry path."""
    source_x = np.broadcast_to(
        (np.arange(width, dtype=np.float32) + np.float32(0.5)) / max(width, 1),
        (height, width),
    )
    source_y = np.broadcast_to(
        ((np.arange(height, dtype=np.float32) + np.float32(0.5)) / max(height, 1))[:, None],
        (height, width),
    )
    mapped = apply_geometry(np.stack((source_x, source_y), axis=-1), geometry)
    output_height, output_width = mapped.shape[:2]

    # Fit a projective map against interior pixel centers after running the
    # coordinate ramps through the real image operation. This keeps Pillow's
    # pixel-center convention, safe inset, crop rounding, flips, and quarter
    # turns in the same contract as the rendered frame.
    sample_x = np.unique(np.linspace(1, max(1, output_width - 2), 7).round().astype(int))
    sample_y = np.unique(np.linspace(1, max(1, output_height - 2), 7).round().astype(int))
    sample_x = np.clip(sample_x, 0, output_width - 1)
    sample_y = np.clip(sample_y, 0, output_height - 1)
    grid_x, grid_y = np.meshgrid(sample_x, sample_y)
    output_u = (grid_x.ravel().astype(np.float64) + 0.5) / max(output_width, 1)
    output_v = (grid_y.ravel().astype(np.float64) + 0.5) / max(output_height, 1)
    samples = mapped[grid_y.ravel(), grid_x.ravel(), :].astype(np.float64)
    source_u = samples[:, 0]
    source_v = samples[:, 1]
    zeros = np.zeros_like(output_u)
    ones = np.ones_like(output_u)
    design = np.vstack(
        (
            np.column_stack((output_u, output_v, ones, zeros, zeros, zeros, -source_u * output_u, -source_u * output_v)),
            np.column_stack((zeros, zeros, zeros, output_u, output_v, ones, -source_v * output_u, -source_v * output_v)),
        )
    )
    targets = np.concatenate((source_u, source_v))
    coefficients, *_ = np.linalg.lstsq(design, targets, rcond=None)
    output_to_source_matrix = np.array(
        [
            [coefficients[0], coefficients[1], coefficients[2]],
            [coefficients[3], coefficients[4], coefficients[5]],
            [coefficients[6], coefficients[7], 1.0],
        ],
        dtype=np.float64,
    )
    source_to_output_matrix = np.linalg.inv(output_to_source_matrix)
    output_to_source_matrix /= output_to_source_matrix[2, 2]
    source_to_output_matrix /= source_to_output_matrix[2, 2]
    output_to_source = tuple(float(value) for value in output_to_source_matrix.ravel())
    source_to_output = tuple(float(value) for value in source_to_output_matrix.ravel())
    return output_to_source, source_to_output, output_width, output_height


def solve_perspective_guides(
    width: int,
    height: int,
    geometry: GeometryAdjustments,
    vertical_guides: list[PerspectiveGuideLine],
    horizontal_guides: list[PerspectiveGuideLine],
) -> tuple[float, float, float, float]:
    """Solve bounded perspective and roll values for user-authored guide pairs."""
    solve_edge = 256
    scale = min(1.0, solve_edge / max(width, height, 1))
    solve_width = max(32, int(round(width * scale)))
    solve_height = max(32, int(round(height * scale)))
    base_output_to_source, _base_source_to_output, _base_width, _base_height = geometry_coordinate_map(
        solve_width, solve_height, geometry
    )
    base_inverse = np.asarray(base_output_to_source, dtype=np.float64).reshape(3, 3)

    source_guides: list[tuple[str, np.ndarray, np.ndarray]] = []
    for orientation, guides in (("vertical", vertical_guides), ("horizontal", horizontal_guides)):
        for guide in guides:
            start = _homogeneous_point(base_inverse, guide.start.x, guide.start.y)
            end = _homogeneous_point(base_inverse, guide.end.x, guide.end.y)
            source_guides.append((orientation, start, end))

    variable_names = []
    if horizontal_guides:
        variable_names.append("perspective_horizontal")
    if vertical_guides:
        variable_names.append("perspective_vertical")
    variable_names.append("perspective_rotate")
    keystone_names = {"perspective_horizontal", "perspective_vertical"}
    values = np.array([float(getattr(geometry, name)) for name in variable_names], dtype=np.float64)
    bounds = np.array([100.0 if name in keystone_names else 45.0 for name in variable_names])
    steps = np.array([0.25 if name in keystone_names else 0.05 for name in variable_names])

    def residuals(candidate_values: np.ndarray) -> np.ndarray:
        candidate = geometry.model_copy(deep=True)
        for name, value in zip(variable_names, candidate_values, strict=True):
            setattr(candidate, name, float(value))
        _candidate_output_to_source, candidate_source_to_output, output_width, output_height = geometry_coordinate_map(
            solve_width, solve_height, candidate
        )
        forward = np.asarray(candidate_source_to_output, dtype=np.float64).reshape(3, 3)
        result: list[float] = []
        for orientation, source_start, source_end in source_guides:
            start = _homogeneous_point(forward, source_start[0], source_start[1])
            end = _homogeneous_point(forward, source_end[0], source_end[1])
            dx = (end[0] - start[0]) * output_width
            dy = (end[1] - start[1]) * output_height
            angle = math.degrees(math.atan2(dx, dy)) if orientation == "vertical" else math.degrees(math.atan2(dy, dx))
            result.append((angle + 90.0) % 180.0 - 90.0)
        return np.asarray(result, dtype=np.float64)

    damping = 1e-3
    for _iteration in range(18):
        residual = residuals(values)
        if float(np.max(np.abs(residual))) <= 0.25:
            break
        jacobian = np.empty((residual.size, values.size), dtype=np.float64)
        for index, step in enumerate(steps):
            shifted = values.copy()
            shifted[index] = np.clip(shifted[index] + step, -bounds[index], bounds[index])
            actual_step = shifted[index] - values[index]
            if abs(actual_step) < 1e-9:
                shifted[index] = np.clip(values[index] - step, -bounds[index], bounds[index])
                actual_step = shifted[index] - values[index]
            jacobian[:, index] = (residuals(shifted) - residual) / actual_step
        normal = jacobian.T @ jacobian + np.eye(values.size) * damping
        try:
            delta = np.linalg.solve(normal, -(jacobian.T @ residual))
        except np.linalg.LinAlgError as exc:
            raise ValueError("Perspective guides do not define a stable correction.") from exc
        trial = np.clip(values + delta, -bounds, bounds)
        if np.linalg.norm(residuals(trial)) < np.linalg.norm(residual):
            values = trial
            damping = max(1e-6, damping * 0.5)
        else:
            damping = min(1e3, damping * 8.0)

    final_residual = residuals(values)
    maximum_residual = float(np.max(np.abs(final_residual)))
    if not np.all(np.isfinite(values)) or maximum_residual > 0.25:
        raise ValueError("The selected guides cannot be aligned within the supported correction range.")
    solved = {name: float(value) for name, value in zip(variable_names, values, strict=True)}
    return (
        solved.get("perspective_horizontal", float(geometry.perspective_horizontal)),
        solved.get("perspective_vertical", float(geometry.perspective_vertical)),
        solved["perspective_rotate"],
        maximum_residual,
    )


def _homogeneous_point(matrix: np.ndarray, x: float, y: float) -> np.ndarray:
    mapped = matrix @ np.array([float(x), float(y), 1.0], dtype=np.float64)
    if abs(mapped[2]) < 1e-10:
        raise ValueError("Perspective correction maps a guide outside the finite image plane.")
    return mapped[:2] / mapped[2]


def _warp_perspective_to_valid_pixels(
    image: np.ndarray,
    straighten_angle: float,
    horizontal: float,
    vertical: float,
) -> np.ndarray:
    """Apply one float32 projective resample and discard every padded edge."""
    try:
        from PIL import Image
    except ImportError as exc:  # pragma: no cover - Pillow is required
        raise RuntimeError("Pillow is required for perspective correction") from exc

    height, width = image.shape[:2]
    inverse = _perspective_inverse_matrix(width, height, straighten_angle, horizontal, vertical)
    coefficients = tuple(float(value) for value in inverse.ravel()[:8])
    channels: list[np.ndarray] = []
    for index in range(image.shape[2]):
        source = image[..., index].astype(np.float32, copy=False)
        transformed = Image.fromarray(source).transform(
            (width, height),
            Image.Transform.PERSPECTIVE,
            coefficients,
            resample=Image.Resampling.BICUBIC,
            fillcolor=0.0,
        )
        channel = np.asarray(transformed, dtype=np.float32)
        channels.append(np.clip(channel, float(np.min(source)), float(np.max(source))))
    result = np.stack(channels, axis=-1)
    left, top, right, bottom = _perspective_safe_rectangle(
        width,
        height,
        round(float(straighten_angle), 6),
        round(float(horizontal), 6),
        round(float(vertical), 6),
    )
    return np.ascontiguousarray(result[top:bottom, left:right], dtype=np.float32)


def _perspective_inverse_matrix(
    width: int,
    height: int,
    straighten_angle: float,
    horizontal: float,
    vertical: float,
) -> np.ndarray:
    """Return Pillow's output-pixel to input-pixel homography."""
    width_scale = max(float(width), 1.0)
    height_scale = max(float(height), 1.0)
    to_normalized = np.array([[1.0 / width_scale, 0.0, 0.0], [0.0, 1.0 / height_scale, 0.0], [0.0, 0.0, 1.0]])
    to_pixels = np.array([[width_scale, 0.0, 0.0], [0.0, height_scale, 0.0], [0.0, 0.0, 1.0]])
    center = np.array([[1.0, 0.0, -0.5], [0.0, 1.0, -0.5], [0.0, 0.0, 1.0]])
    uncenter = np.array([[1.0, 0.0, 0.5], [0.0, 1.0, 0.5], [0.0, 0.0, 1.0]])

    # Screen coordinates have positive Y downward. Match Pillow's positive
    # counter-clockwise editor semantics used by the existing Straighten path.
    angle = math.radians(float(straighten_angle))
    cosine = math.cos(angle)
    sine = math.sin(angle)
    rotation = np.array([[cosine, sine, 0.0], [-sine, cosine, 0.0], [0.0, 0.0, 1.0]])
    projective = np.array(
        [
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.45 * float(horizontal) / 100.0, 0.45 * float(vertical) / 100.0, 1.0],
        ]
    )
    forward = to_pixels @ uncenter @ projective @ rotation @ center @ to_normalized
    inverse = np.linalg.inv(forward)
    inverse /= inverse[2, 2]
    return inverse


@lru_cache(maxsize=128)
def _perspective_safe_rectangle(
    width: int,
    height: int,
    straighten_angle: float,
    horizontal: float,
    vertical: float,
) -> tuple[int, int, int, int]:
    """Find a conservative maximal valid rectangle on a bounded mask proxy."""
    try:
        from PIL import Image
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("Pillow is required for perspective correction") from exc

    scale = min(1.0, 512.0 / max(width, height, 1))
    proxy_width = max(8, int(round(width * scale)))
    proxy_height = max(8, int(round(height * scale)))
    inverse = _perspective_inverse_matrix(proxy_width, proxy_height, straighten_angle, horizontal, vertical)
    coefficients = tuple(float(value) for value in inverse.ravel()[:8])
    mask = Image.new("F", (proxy_width, proxy_height), 1.0).transform(
        (proxy_width, proxy_height),
        Image.Transform.PERSPECTIVE,
        coefficients,
        resample=Image.Resampling.BICUBIC,
        fillcolor=0.0,
    )
    valid = np.asarray(mask, dtype=np.float32) >= np.float32(0.99999)
    proxy_rect = _largest_true_rectangle(valid)
    if proxy_rect is None:
        raise ValueError("Perspective correction is too strong to retain a valid image area.")
    left, top, right, bottom = proxy_rect
    # A three-proxy-pixel inset is deliberately conservative: bicubic support
    # must never sample the padded exterior in a full-resolution export.
    inset = 3
    left = min(right - 1, left + inset)
    top = min(bottom - 1, top + inset)
    right = max(left + 1, right - inset)
    bottom = max(top + 1, bottom - inset)
    x_scale = width / proxy_width
    y_scale = height / proxy_height
    full_left = min(width - 1, max(0, int(math.ceil(left * x_scale))))
    full_top = min(height - 1, max(0, int(math.ceil(top * y_scale))))
    full_right = min(width, max(full_left + 1, int(math.floor(right * x_scale))))
    full_bottom = min(height, max(full_top + 1, int(math.floor(bottom * y_scale))))
    return full_left, full_top, full_right, full_bottom


def _largest_true_rectangle(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    """Return the largest all-true axis-aligned rectangle as exclusive bounds."""
    if mask.ndim != 2 or not np.any(mask):
        return None
    heights = np.zeros(mask.shape[1], dtype=np.int32)
    best_area = 0
    best: tuple[int, int, int, int] | None = None
    for row in range(mask.shape[0]):
        heights = np.where(mask[row], heights + 1, 0)
        stack: list[tuple[int, int]] = []
        for column in range(mask.shape[1] + 1):
            current = int(heights[column]) if column < mask.shape[1] else 0
            start = column
            while stack and stack[-1][1] > current:
                start_index, bar_height = stack.pop()
                area = bar_height * (column - start_index)
                if area > best_area:
                    best_area = area
                    best = (start_index, row + 1 - bar_height, column, row + 1)
                start = start_index
            if not stack or stack[-1][1] < current:
                stack.append((start, current))
    return best


def _rotate_to_valid_pixels(image: np.ndarray, angle_degrees: float) -> np.ndarray:
    try:
        from PIL import Image
    except ImportError as exc:  # pragma: no cover - Pillow is a required runtime dependency
        raise RuntimeError("Pillow is required for straightening") from exc

    height, width = image.shape[:2]
    channels: list[np.ndarray] = []
    for index in range(image.shape[2]):
        source = image[..., index].astype(np.float32, copy=False)
        rotated = Image.fromarray(source).rotate(
            float(angle_degrees), resample=Image.Resampling.BICUBIC, expand=True, fillcolor=0.0
        )
        channel = np.asarray(rotated, dtype=np.float32)
        channels.append(np.clip(channel, float(np.min(source)), float(np.max(source))))
    result = np.stack(channels, axis=-1)
    safe_width, safe_height = _largest_rotated_rectangle(width, height, math.radians(abs(angle_degrees)))
    # Bicubic support reaches two samples beyond the nominal coordinate. Keep a
    # two-pixel inset on each edge so even the resampling kernel sees source
    # pixels only; this is what guarantees there are no synthesized corners.
    safe_width = max(1, min(int(math.floor(safe_width)) - 4, result.shape[1]))
    safe_height = max(1, min(int(math.floor(safe_height)) - 4, result.shape[0]))
    left = (result.shape[1] - safe_width) // 2
    top = (result.shape[0] - safe_height) // 2
    return np.ascontiguousarray(result[top : top + safe_height, left : left + safe_width], dtype=np.float32)


def _largest_rotated_rectangle(width: int, height: int, angle: float) -> tuple[float, float]:
    """Largest centered axis-aligned rectangle containing only rotated source pixels."""
    if width <= 0 or height <= 0:
        return 0.0, 0.0
    sin_a = abs(math.sin(angle))
    cos_a = abs(math.cos(angle))
    if sin_a < 1e-9:
        return float(width), float(height)
    width_is_longer = width >= height
    side_long = float(width if width_is_longer else height)
    side_short = float(height if width_is_longer else width)
    if side_short <= 2.0 * sin_a * cos_a * side_long or abs(sin_a - cos_a) < 1e-9:
        half_short = 0.5 * side_short
        safe_width = half_short / sin_a if width_is_longer else half_short / cos_a
        safe_height = half_short / cos_a if width_is_longer else half_short / sin_a
    else:
        cos_2a = cos_a * cos_a - sin_a * sin_a
        safe_width = (width * cos_a - height * sin_a) / cos_2a
        safe_height = (height * cos_a - width * sin_a) / cos_2a
    return abs(safe_width), abs(safe_height)


def resolve_output_dimensions(
    width: int, height: int, settings: OutputFinishingSettings
) -> tuple[int, int]:
    if settings.resize_mode == "original":
        return width, height
    if settings.resize_mode == "long_edge":
        scale = float(settings.long_edge) / max(width, height)
    else:
        scale = min(float(settings.width) / width, float(settings.height) / height)
    if settings.prevent_enlargement:
        scale = min(1.0, scale)
    return max(1, int(round(width * scale))), max(1, int(round(height * scale)))


def apply_output_finishing(
    image: np.ndarray, settings: OutputFinishingSettings, kind: PreviewKind
) -> np.ndarray:
    height, width = image.shape[:2]
    target_width, target_height = resolve_output_dimensions(width, height, settings)
    result = image
    if (target_width, target_height) != (width, height):
        result = _resize_lanczos(result, target_width, target_height)
    if settings.sharpening != "off":
        result = _edge_aware_multiscale_sharpen(result, settings.sharpening, kind)
    upper = None if kind == PreviewKind.HDR else 1.0
    return np.nan_to_num(np.clip(result, 0.0, upper), nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)


def _resize_lanczos(image: np.ndarray, width: int, height: int) -> np.ndarray:
    try:
        from PIL import Image
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("Pillow is required for export resizing") from exc
    channels: list[np.ndarray] = []
    for index in range(image.shape[2]):
        source = image[..., index].astype(np.float32, copy=False)
        resized = Image.fromarray(source, mode="F").resize((width, height), Image.Resampling.LANCZOS)
        channel = np.asarray(resized, dtype=np.float32)
        channels.append(np.clip(channel, float(np.min(source)), float(np.max(source))))
    return np.stack(channels, axis=-1).astype(np.float32)


def _edge_aware_multiscale_sharpen(image: np.ndarray, strength: str, kind: PreviewKind) -> np.ndarray:
    if float(np.max(image) - np.min(image)) <= 1e-7:
        return image
    amounts = {
        "subtle": (0.22, 0.08),
        "standard": (0.38, 0.14),
        "strong": (0.58, 0.22),
    }
    fine_amount, medium_amount = amounts[strength]
    source_luma = _luminance(image, kind)
    if kind == PreviewKind.HDR:
        signal = np.log2(np.maximum(source_luma, 1e-7) / np.float32(0.18))
    else:
        signal = _srgb_encode(np.clip(source_luma, 0.0, 1.0))

    fine_base = _box_blur(signal, 1)
    medium_base = _box_blur(fine_base, 2)
    fine = signal - fine_base
    medium = fine_base - medium_base

    gradient_x = np.abs(np.diff(medium_base, axis=1, append=medium_base[:, -1:]))
    gradient_y = np.abs(np.diff(medium_base, axis=0, append=medium_base[-1:, :]))
    structure = np.sqrt(gradient_x * gradient_x + gradient_y * gradient_y)
    residual = _box_blur(np.abs(fine), 1)
    # Coherent structure wins over stochastic residuals, while ordinary texture
    # retains a conservative floor. Flat fields remain exactly unchanged.
    mask = np.clip(0.18 + 2.8 * structure / (structure + residual + 1e-6), 0.0, 1.0)
    mask = np.where((np.abs(fine) + np.abs(medium)) > 1e-7, mask, 0.0).astype(np.float32)
    detail = mask * (np.float32(fine_amount) * fine + np.float32(medium_amount) * medium)
    if not np.any(np.abs(detail) > 1e-7):
        return image

    local_min, local_max = _local_extrema(signal)
    allowance = np.float32(0.12 if strength != "strong" else 0.18) * (local_max - local_min)
    sharpened = np.clip(signal + detail, local_min - allowance, local_max + allowance)
    if kind == PreviewKind.HDR:
        target_luma = np.float32(0.18) * np.exp2(np.clip(sharpened, -32.0, 16.0))
    else:
        target_luma = _srgb_decode(np.clip(sharpened, 0.0, 1.0))
    gain = np.ones_like(source_luma, dtype=np.float32)
    np.divide(target_luma, source_luma, out=gain, where=source_luma > 1e-7)
    return (image.astype(np.float32, copy=False) * gain[..., None]).astype(np.float32)


def _luminance(image: np.ndarray, kind: PreviewKind) -> np.ndarray:
    weights = np.array([0.2722287, 0.6740818, 0.0536895], dtype=np.float32) if kind == PreviewKind.HDR else np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    return np.einsum("...c,c->...", image[..., :3], weights, optimize=True).astype(np.float32)


def _box_blur(image: np.ndarray, radius: int) -> np.ndarray:
    result = image.astype(np.float32, copy=False)
    for axis in (0, 1):
        padded = np.pad(result, [(radius, radius), (radius, radius)], mode="edge") if axis == 0 else None
        if axis == 0:
            padded = padded[:, radius:-radius] if radius else padded
        else:
            padded = np.pad(result, [(0, 0), (radius, radius)], mode="edge")
        cumulative = np.cumsum(padded, axis=axis, dtype=np.float32)
        zero_shape = list(cumulative.shape)
        zero_shape[axis] = 1
        cumulative = np.concatenate([np.zeros(zero_shape, dtype=np.float32), cumulative], axis=axis)
        high = [slice(None), slice(None)]
        low = [slice(None), slice(None)]
        width = radius * 2 + 1
        high[axis] = slice(width, None)
        low[axis] = slice(None, -width)
        result = (cumulative[tuple(high)] - cumulative[tuple(low)]) / np.float32(width)
    return result.astype(np.float32)


def _local_extrema(signal: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    padded = np.pad(signal, 1, mode="edge")
    neighborhoods = [padded[y : y + signal.shape[0], x : x + signal.shape[1]] for y in range(3) for x in range(3)]
    return np.minimum.reduce(neighborhoods), np.maximum.reduce(neighborhoods)


def _srgb_encode(value: np.ndarray) -> np.ndarray:
    clipped = np.clip(value, 0.0, 1.0)
    return np.where(clipped <= 0.0031308, clipped * 12.92, 1.055 * np.power(clipped, 1.0 / 2.4) - 0.055).astype(np.float32)


def _srgb_decode(value: np.ndarray) -> np.ndarray:
    clipped = np.clip(value, 0.0, 1.0)
    return np.where(clipped <= 0.04045, clipped / 12.92, np.power((clipped + 0.055) / 1.055, 2.4)).astype(np.float32)
