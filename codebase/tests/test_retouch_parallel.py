"""Parallel score lanes preserve the serial candidate scores and donor ordering."""
from concurrent.futures import CancelledError
import numpy as np
import pytest
from hdr_finisher.retouch_parallel import score, ordered


@pytest.mark.parametrize("align_tone", [False, True])
def test_partitioned_scores_match_whole_array_reductions_exactly(align_tone):
    rng = np.random.default_rng(20261028)
    source = rng.normal(size=(32, 40, 3))
    mean = rng.normal(size=source.shape)
    offsets = np.array([(y, x) for y in range(-3, 4) for x in range(-3, 4)])
    candidates = rng.integers((3, 3), (29, 37), size=(311, 2))
    target = rng.normal(size=(311, 49, 3))
    confidence = rng.choice([0., .25, 1.], size=(311, 49))
    sy = candidates[:, 0, None] + offsets[:, 0]
    sx = candidates[:, 1, None] + offsets[:, 1]
    diff = source[sy, sx] - target
    if align_tone:
        diff -= mean[candidates[:, 0], candidates[:, 1]][:, None, :]
    expected = np.sum(diff * diff * confidence[..., None], axis=(1, 2))
    actual = score(candidates, target, source, mean, offsets, confidence, align_tone, lambda: None)
    np.testing.assert_array_equal(actual, expected)
    np.testing.assert_array_equal(np.argsort(actual), np.argsort(expected))


def test_lane_failure_joins_owned_work_and_propagates_cancellation():
    def stop(_):
        raise CancelledError("newer edit")
    with pytest.raises(CancelledError, match="newer edit"):
        ordered(stop, range(4))
