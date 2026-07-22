from __future__ import annotations

from hdr_finisher.capabilities import probe_capabilities
from hdr_finisher.models import CapabilityStatus


def test_jxl_and_ultrahdr_exports_are_capability_gated() -> None:
    capabilities = probe_capabilities()
    assert "jpegxl_encoder" in capabilities
    assert "ultrahdr_encoder" in capabilities
    assert capabilities["jpegxl_encoder"].status in {CapabilityStatus.AVAILABLE, CapabilityStatus.MISSING}
    assert capabilities["ultrahdr_encoder"].status in {
        CapabilityStatus.AVAILABLE,
        CapabilityStatus.MISSING,
        CapabilityStatus.UNVERIFIED,
    }
