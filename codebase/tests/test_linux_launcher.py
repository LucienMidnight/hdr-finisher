from __future__ import annotations

import os

import pytest

from hdr_finisher.launcher import _parent_is_alive


@pytest.mark.skipif(os.name == "nt", reason="POSIX parent-process behavior")
def test_posix_parent_liveness_detects_current_and_missing_processes() -> None:
    assert _parent_is_alive(os.getpid()) is True
    assert _parent_is_alive(2_147_483_647) is False
