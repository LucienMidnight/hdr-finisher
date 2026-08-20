from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from pathlib import Path
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.linear_dng_probe import (
    GIB,
    ResourceSnapshot,
    _rational_array,
    _select_primary_page,
    estimate_memory,
    qualify_page,
)


@dataclass
class FakeTag:
    value: object


class FakePage:
    def __init__(self, *, photometric: int = 34892, samples: int = 3, tags: dict[str, object] | None = None):
        self.photometric = photometric
        self.samplesperpixel = samples
        self.dtype = np.dtype("uint16")
        self.bitspersample = (16, 16, 16)
        self.compression = 1
        self.imagewidth = 6000
        self.imagelength = 4000
        self.subfiletype = 0
        values = {
            "ColorMatrix1": (1, 1) * 9,
            "ForwardMatrix1": (1, 1) * 9,
            "CalibrationIlluminant1": 21,
            "AsShotNeutral": (1, 1) * 3,
        }
        values.update(tags or {})
        self.tags = {name: FakeTag(value) for name, value in values.items()}


def test_qualifying_linear_dng_resolves_standard_defaults() -> None:
    reasons, notes, metadata = qualify_page(FakePage(), decoder_available=True)

    assert reasons == []
    assert "BlackLevel resolved from its DNG/TIFF default." in notes
    assert metadata["resolved_defaults"]["WhiteLevel"] == [65535.0, 65535.0, 65535.0]
    assert metadata["resolved_defaults"]["ActiveArea"] == [0, 0, 4000, 6000]


def test_mosaic_and_unimplemented_opcode_are_rejected_specifically() -> None:
    reasons, _notes, _metadata = qualify_page(
        FakePage(photometric=32803, samples=1, tags={"OpcodeList2": b"required"}),
        decoder_available=True,
    )

    assert "PhotometricInterpretation is not LinearRaw." in reasons
    assert "Linear DNG path requires exactly 3 samples per pixel; found 1." in reasons
    assert "Unimplemented rendering metadata is present: OpcodeList2." in reasons


def test_memory_preflight_rejects_when_reserve_leaves_too_little_ram() -> None:
    estimate = estimate_memory(
        width=72_480,
        height=4_096,
        samples=3,
        bytes_per_sample=2,
        resources=ResourceSnapshot(total_ram_bytes=16 * GIB, available_ram_bytes=7 * GIB, source="test"),
        memmappable=False,
    )

    assert estimate.conservative_import_peak_bytes > estimate.safely_available_bytes
    assert estimate.import_preflight == "reject"


def test_memory_preflight_allows_memmappable_source_on_large_system() -> None:
    estimate = estimate_memory(
        width=72_480,
        height=4_096,
        samples=3,
        bytes_per_sample=2,
        resources=ResourceSnapshot(total_ram_bytes=128 * GIB, available_ram_bytes=96 * GIB, source="test"),
        memmappable=True,
    )

    assert estimate.optimistic_import_peak_bytes < estimate.conservative_export_peak_bytes
    assert estimate.import_preflight == "pass"
    assert estimate.export_preflight == "pass"


def test_unknown_resource_state_never_claims_import_is_safe() -> None:
    estimate = estimate_memory(
        width=6000,
        height=4000,
        samples=3,
        bytes_per_sample=2,
        resources=ResourceSnapshot(None, None, "unavailable"),
        memmappable=True,
    )

    assert estimate.safely_available_bytes is None
    assert estimate.import_preflight == "unknown_resources"


def test_rational_array_decodes_dng_numerator_denominator_pairs() -> None:
    result = _rational_array((1, 2, 3, 4, 5, 2), 3)

    assert np.allclose(result, [0.5, 0.75, 2.5])


def test_raw_subifd_can_inherit_color_metadata_from_root_ifd() -> None:
    root = FakePage(tags={"Software": "DxO PhotoLab"})
    child = FakePage(tags={})
    child.tags = {"WhiteLevel": FakeTag((65535, 65535, 65535))}

    reasons, _notes, metadata = qualify_page(child, decoder_available=True, metadata_page=root)

    assert reasons == []
    assert metadata["Software"] == "DxO PhotoLab"
    assert metadata["ColorMatrix1"] is not None


def test_reduced_linear_fast_load_data_does_not_override_primary_mosaic() -> None:
    primary = FakePage(photometric=32803, samples=1)
    primary.imagewidth = 8000
    primary.imagelength = 5320
    reduced_linear = FakePage()
    reduced_linear.imagewidth = 1988
    reduced_linear.imagelength = 1326
    reduced_linear.subfiletype = 1
    tif = SimpleNamespace(
        series=[
            SimpleNamespace(pages=[primary]),
            SimpleNamespace(pages=[reduced_linear]),
        ]
    )

    assert _select_primary_page(tif) is primary
