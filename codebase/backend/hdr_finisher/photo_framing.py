"""HDRF-owned nested rectangles. BorderMuse's canvas formula remains untouched.

Widths are authored in cropped source pixels or percent of its shorter side.
Round half up once at source size, then once for final output; viewers scale
these rectangles instead of rounding again at proxy or display resolution.
"""
from dataclasses import dataclass
from fractions import Fraction

from .models import PhotoFraming


def half_up(value):
    value = Fraction(value)
    return (2 * value.numerator + value.denominator) // (2 * value.denominator)


def layer_pixels(layer, width, height):
    if not layer.enabled:
        return 0
    value = Fraction(str(layer.value))
    return half_up(value * min(width, height) / 100 if layer.unit == "percent" else value)


def convert_thickness(value, unit, target_unit, width, height):
    """Do not round conversions: UI formatting must not become authored data."""
    if unit not in {"percent", "px"} or target_unit not in {"percent", "px"}:
        raise ValueError("Unknown thickness unit")
    if min(width, height) < 1:
        raise ValueError("Photo dimensions must be positive")
    if unit == target_unit:
        return value
    return float(Fraction(str(value)) * min(width, height) / 100 if unit == "percent" else Fraction(str(value)) * 100 / min(width, height))


@dataclass(frozen=True)
class FramingLayout:
    width: int
    height: int
    frame: int = 0
    border: int = 0

    @property
    def inset(self):
        return self.frame + self.border

    @property
    def photo(self):
        return (self.inset, self.inset, self.width - 2 * self.inset, self.height - 2 * self.inset)

    def as_dict(self):
        return dict(width=self.width, height=self.height, frame=self.frame, border=self.border,
                    photo=list(self.photo))


def source_layout(width, height, framing):
    if width < 1 or height < 1:
        raise ValueError("Photo dimensions must be positive")
    framing = framing or PhotoFraming()
    frame = layer_pixels(framing.frame, width, height) if framing.enabled else 0
    border = layer_pixels(framing.border, width, height) if framing.enabled else 0
    return FramingLayout(width + 2 * (frame + border), height + 2 * (frame + border), frame, border)


def output_layout(width, height, framing, finishing, include=True):
    from .finishing import resolve_output_dimensions
    source = source_layout(width, height, framing if include else None)
    try:
        target_width, target_height = resolve_output_dimensions(source.width, source.height, finishing)
    except (OverflowError, ZeroDivisionError) as error:
        raise ValueError("The frame thickness is too large to resolve. Use a smaller value.") from error
    scale = min(Fraction(target_width, source.width), Fraction(target_height, source.height))
    # Tiny outputs may have no room for one or both layers. Never consume the
    # last photo pixel or grow the requested canvas to retain a mat.
    available = (min(target_width, target_height) - 1) // 2
    total = min(available, half_up(source.inset * scale))
    border = min(total, half_up(source.border * scale))
    if finishing.prevent_enlargement:
        # A very narrow photo can lose both margins when the canvas rounds to
        # two pixels. Shrink that canvas axis rather than enlarging its photo.
        target_width = min(target_width, width + 2 * total)
        target_height = min(target_height, height + 2 * total)
    return FramingLayout(target_width, target_height, total - border, border)

def delivery_layout(session, settings, adjustments):
    """Resolve from native cropped photo pixels, including reduced Proof."""
    from .finishing import geometry_output_dimensions
    framing = getattr(session, "framing", None)
    if not settings.export_with_frame or framing is None or not framing.enabled:
        return None
    height, width = session.image.shape[:2]
    width, height = getattr(session, "framing_source_size", None) or geometry_output_dimensions(
        width, height, adjustments.shared.geometry)
    layout = output_layout(width, height, framing, settings.output_finishing)
    limit = getattr(session, "framing_output_limit", None)
    if limit and max(layout.width, layout.height) > limit:
        from .models import OutputFinishingSettings
        layout = output_layout(width, height, framing, OutputFinishingSettings(
            resize_mode="long_edge", long_edge=limit, prevent_enlargement=True))
    from .resource_preflight import detect_memory_resources, estimate_resources
    estimate = estimate_resources(width=layout.width, height=layout.height,
        samples=4, bytes_per_sample=4, resources=detect_memory_resources(),
        retained_session_bytes=session.image.nbytes)
    if estimate.export_decision == "reject":
        raise ValueError("The framed canvas is too large for available memory. Choose a smaller export size or thinner frame.")
    return layout


def layer_colors(framing, lane, white, ceiling=10000):
    import numpy as np
    from .color import linear_srgb_to_acescg, acescg_to_linear_bt2020
    def convert(hex_color):
        srgb = np.array([int(hex_color[i:i+2], 16) / 255 for i in (1, 3, 5)], dtype=np.float32)
        linear = np.where(srgb <= .04045, srgb / 12.92, ((srgb + .055) / 1.055) ** 2.4)
        if lane == "sdr":
            return linear.astype(np.float32)
        # HDR uses scene-linear ACEScg: 0.18 is reference white. The picker
        # describes display sRGB, never scene-linear primaries or HDR peak.
        aces = linear_srgb_to_acescg(linear) * np.float32(.18)
        peak = float(np.max(acescg_to_linear_bt2020(aces))) * white / .18
        if peak > ceiling:
            aces *= np.float32(ceiling / peak)
        return aces.astype(np.float32)
    return convert(framing.frame.color), convert(framing.border.color)


def compose(image, layout, colors):
    import numpy as np
    if layout is None:
        return image
    if image.shape[:2] != (layout.photo[3], layout.photo[2]):
        raise ValueError("Photo pixels do not match the framing content rectangle")
    frame, border = colors
    result = np.empty((layout.height, layout.width, 3), dtype=np.float32)
    result[:] = border
    b = layout.border
    result[b:layout.height-b or None, b:layout.width-b or None] = frame
    x, y, width, height = layout.photo
    result[y:y+height, x:x+width] = image
    return result
