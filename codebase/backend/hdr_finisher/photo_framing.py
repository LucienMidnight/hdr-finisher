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
    return value * min(width, height) / 100 if unit == "percent" else value * 100 / min(width, height)


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
    target_width, target_height = resolve_output_dimensions(source.width, source.height, finishing)
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