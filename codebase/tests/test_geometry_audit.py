import math

import numpy as np
import pytest

from hdr_finisher.finishing import (
    _perspective_inverse_matrix,
    apply_geometry,
    geometry_output_dimensions,
    perspective_guide_transform,
    solve_perspective_guides,
)
from hdr_finisher.models import GeometryAdjustments, PerspectiveGuideLine


@pytest.mark.parametrize("width,height", [(320, 180), (180, 320), (256, 256)])
@pytest.mark.parametrize("angle", [-35, 17, 45, 90])
def test_perspective_roll_is_a_rigid_pixel_rotation(width, height, angle):
    inverse = _perspective_inverse_matrix(width, height, angle, 0, 0)
    linear = inverse[:2, :2]
    np.testing.assert_allclose(linear.T @ linear, np.eye(2), atol=1e-12)
    assert math.isclose(np.linalg.det(linear), 1, abs_tol=1e-12)
    center = np.array([width / 2, height / 2, 1])
    np.testing.assert_allclose(inverse @ center, center, atol=1e-10)


@pytest.mark.parametrize("width,height", [(320, 180), (180, 320), (91, 159), (4, 3)])
@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
@pytest.mark.parametrize("roll,horizontal,vertical", [(0, 0, 0), (13, 0, 0), (45, 0, 0), (-9, 31, -22), (0, -100, 100)])
def test_geometry_dimensions_match_actual_float_render(width, height, rotation, roll, horizontal, vertical):
    geometry = GeometryAdjustments(
        rotation=rotation, flip_horizontal=True, flip_vertical=True,
        straighten_angle=roll, perspective_rotate=roll,
        perspective_horizontal=horizontal, perspective_vertical=vertical,
        crop={"x": 0.1, "y": 0.05, "width": 0.75, "height": 0.8},
    )
    image = np.full((height, width, 3), 4.0, dtype=np.float32)
    output = apply_geometry(image, geometry)
    assert geometry_output_dimensions(width, height, geometry) == (output.shape[1], output.shape[0])
    assert output.dtype == np.float32
    assert np.isfinite(output).all()
    np.testing.assert_allclose(output, 4.0, atol=1e-5)


@pytest.mark.parametrize("width,height", [(1600, 900), (900, 1600)])
def test_reapplying_solved_guides_does_not_accumulate_correction(width, height):
    geometry = GeometryAdjustments()
    guides = [
        PerspectiveGuideLine(start={"x": 0.343, "y": 0.15}, end={"x": 1 / 3, "y": 0.85}),
        PerspectiveGuideLine(start={"x": 2 / 3, "y": 0.15}, end={"x": 2 / 3, "y": 0.85}),
    ]
    first = None
    for _ in range(4):
        horizontal, vertical, roll, residual = solve_perspective_guides(width, height, geometry, guides, [])
        assert residual <= 0.25
        if first is None:
            first = (horizontal, vertical, roll)
        else:
            np.testing.assert_allclose((horizontal, vertical, roll), first, atol=1e-9)
        solved = geometry.model_copy(update={
            "perspective_horizontal": horizontal, "perspective_vertical": vertical, "perspective_rotate": roll,
        })
        transform = np.asarray(perspective_guide_transform(width, height, geometry, solved)).reshape(3, 3)
        def mapped(point):
            output = transform @ [point.x, point.y, 1]
            return {"x": output[0] / output[2], "y": output[1] / output[2]}
        guides = [PerspectiveGuideLine(start=mapped(guide.start), end=mapped(guide.end)) for guide in guides]
        geometry = solved
