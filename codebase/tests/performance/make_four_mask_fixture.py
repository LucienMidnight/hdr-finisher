"""Build the second Viewport-Bounded GPU Preview fixture (PRD section 8).

    python tests/performance/make_four_mask_fixture.py --source "D:\\Photos\\HDR Test Images\\DSC00264.ARW" \
        --project local-test-media/viewport/DSC00264-four-masks.hdrfinisher

The owner's case: a 42 MP Sony RAW, uncropped, with a linear gradient, a
luminance range, a path and a brush, each with an exposure adjustment. The RAW
is only read. The project is a new file and is never written over: delete it
by hand to regenerate. A small picture of the decoded source with the mask
outlines is written beside it so the placement can be checked by eye.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from reference_session import isolate_source_cache


def four_mask_locals():
    from hdr_finisher.models import (
        BrushStroke,
        LocalAdjustment,
        LocalGrade,
        MaskExpression,
        MaskLeaf,
        MaskPoint,
        PathNode,
    )

    def local(name: str, leaf: MaskLeaf, exposure: float) -> LocalAdjustment:
        return LocalAdjustment(
            name=name,
            mask=MaskExpression(leaf=leaf),
            hdr_grade=LocalGrade(exposure=exposure),
            sdr_grade=LocalGrade(exposure=exposure),
        )

    def stroke(points: list[tuple[float, float]], radius: float) -> BrushStroke:
        return BrushStroke(points=[MaskPoint(x=x, y=y) for x, y in points], radius=radius, hardness=0.5, flow=0.8)

    return [
        local(
            "Gradient",
            MaskLeaf(type="linear_gradient", start=MaskPoint(x=0.5, y=0.02), end=MaskPoint(x=0.5, y=0.45)),
            -0.7,
        ),
        local(
            "Luminance",
            MaskLeaf(
                type="luminance_range",
                fade_in_start_ev=1.0,
                full_start_ev=2.0,
                full_end_ev=8.0,
                fade_out_end_ev=10.0,
                mask_feather=0.004,
            ),
            -0.5,
        ),
        # Unfeathered, so the fixture carries one hard-edged mask (PRD 4.2).
        local(
            "Path",
            MaskLeaf(
                type="path",
                nodes=[
                    PathNode(x=0.58, y=0.52, node_type="sharp"),
                    PathNode(x=0.92, y=0.56, node_type="sharp"),
                    PathNode(x=0.88, y=0.93, node_type="sharp"),
                    PathNode(x=0.62, y=0.88, node_type="sharp"),
                ],
            ),
            0.6,
        ),
        # Feathered and painted in several overlapping strokes, as a hand does.
        local(
            "Brush",
            MaskLeaf(
                type="brush",
                strokes=[
                    stroke([(0.10, 0.62), (0.18, 0.66), (0.27, 0.64), (0.36, 0.70)], 0.035),
                    stroke([(0.12, 0.72), (0.22, 0.76), (0.33, 0.78), (0.44, 0.74)], 0.04),
                    stroke([(0.16, 0.84), (0.28, 0.86), (0.40, 0.84)], 0.045),
                    stroke([(0.30, 0.56), (0.34, 0.62)], 0.02),
                ],
                mask_feather=0.0085,
            ),
            0.8,
        ),
    ]


def many_locals(count: int):
    """The synthetic scaling case (PRD section 8): ``count`` locals, the four kinds in rotation.

    Each is a small, deterministic variation in placement, with a small
    exposure so fifty of them still leave a picture.
    """
    from hdr_finisher.models import BrushStroke, LocalAdjustment, LocalGrade, MaskExpression, MaskLeaf, MaskPoint, PathNode

    locals_: list[LocalAdjustment] = []
    for index in range(count):
        phase = (index * 0.61803398875) % 1.0
        other = (index * 0.41421356237) % 1.0
        kind = index % 4
        if kind == 0:
            leaf = MaskLeaf(type="linear_gradient", start=MaskPoint(x=0.1 + 0.8 * phase, y=0.05 + 0.3 * other),
                            end=MaskPoint(x=0.1 + 0.8 * other, y=0.55 + 0.4 * phase))
        elif kind == 1:
            low = -2.0 + 6.0 * phase
            leaf = MaskLeaf(type="luminance_range", fade_in_start_ev=low, full_start_ev=low + 1.0,
                            full_end_ev=low + 3.0, fade_out_end_ev=low + 4.0, mask_feather=0.004)
        elif kind == 2:
            x, y = 0.08 + 0.6 * phase, 0.08 + 0.6 * other
            leaf = MaskLeaf(type="path", nodes=[
                PathNode(x=x, y=y, node_type="sharp"), PathNode(x=x + 0.28, y=y + 0.03, node_type="sharp"),
                PathNode(x=x + 0.25, y=y + 0.3, node_type="sharp"), PathNode(x=x + 0.02, y=y + 0.26, node_type="sharp"),
            ])
        else:
            x, y = 0.1 + 0.6 * phase, 0.1 + 0.7 * other
            leaf = MaskLeaf(type="brush", mask_feather=0.0085, strokes=[BrushStroke(
                points=[MaskPoint(x=x, y=y), MaskPoint(x=x + 0.1, y=y + 0.04), MaskPoint(x=x + 0.2, y=y + 0.02)],
                radius=0.03, hardness=0.5, flow=0.8)])
        exposure = 0.12 if index % 2 else -0.12
        locals_.append(LocalAdjustment(name=f"Local {index + 1}", mask=MaskExpression(leaf=leaf),
                                       hdr_grade=LocalGrade(exposure=exposure), sdr_grade=LocalGrade(exposure=exposure)))
    return locals_


def write_contact_sheet(session, destination: Path) -> None:
    from PIL import Image

    from hdr_finisher.color import acescg_to_linear_srgb
    from hdr_finisher.local_adjustments import compile_geometry_fixed_mask
    from hdr_finisher.render_cache import downsample_image

    small = downsample_image(session.image, 1600)
    display = np.clip(acescg_to_linear_srgb(small * np.float32(2.0 ** float(session.adjustments.hdr.exposure))), 0.0, None)
    display = display / (1.0 + display)
    picture = np.power(display, 1.0 / 2.2)
    colours = [(1.0, 0.3, 0.3), (1.0, 0.9, 0.2), (0.3, 1.0, 0.4), (0.3, 0.7, 1.0)]
    for local, colour in zip(session.local_adjustments, colours):
        mask = compile_geometry_fixed_mask(small, local.mask, session.adjustments.shared.geometry, spatial_only=True) >= 128
        edge = np.zeros_like(mask)
        edge[1:, :] |= mask[1:, :] != mask[:-1, :]
        edge[:, 1:] |= mask[:, 1:] != mask[:, :-1]
        edge[1:, :] |= edge[:-1, :].copy()
        edge[:, 1:] |= edge[:, :-1].copy()
        picture[edge] = colour
    Image.fromarray(np.round(np.clip(picture, 0.0, 1.0) * 255.0).astype(np.uint8)).save(destination)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the four-mask 42 MP fixture project")
    parser.add_argument("--source", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--locals", type=int, default=0, help="build the synthetic N-local scaling project instead")
    arguments = parser.parse_args()
    source = Path(arguments.source).resolve()
    project = Path(arguments.project).resolve()
    if project.exists():
        raise SystemExit(f"{project} already exists; delete it to regenerate.")
    project.parent.mkdir(parents=True, exist_ok=True)
    isolate_source_cache(project.parent / "source-cache")

    from hdr_finisher.projects import save_project
    from hdr_finisher.sessions import SessionStore

    before = (source.stat().st_size, source.stat().st_mtime_ns)
    store = SessionStore()
    payload = store.create_session(source, original_filename=source.name, owns_source_path=False)
    session = store.get(payload.session_id)
    session.local_adjustments = many_locals(arguments.locals) if arguments.locals else four_mask_locals()
    save_project(session, project, source)
    if not arguments.locals:
        write_contact_sheet(session, project.with_suffix(".masks.png"))
    height, width = session.image.shape[:2]
    if (source.stat().st_size, source.stat().st_mtime_ns) != before:
        raise SystemExit("The source file changed while the fixture was built.")
    print(f"Wrote {project}: {width} x {height} ({width * height / 1e6:.1f} MP), {len(session.local_adjustments)} locals")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
