# Adapted from BorderMuse geometry/test_reference.py at 83abc8e6594529867c044dabd350ddbe26b6fa59.
# Copyright (c) 2026 Pedro C. Silva; MIT, see ../bin/licenses/bordermuse-MIT.txt.
# HDRF changes: import and fixture locations only.
"""Measured conformance vectors, plus exact-arithmetic boundary checks."""

from dataclasses import asdict
from fractions import Fraction
import json
from pathlib import Path
import unittest

from hdr_finisher.vendor.bordermuse.reference import SPEC_ID, calculate


class GeometryContractTests(unittest.TestCase):
    def test_measured_mobile_exports(self):
        fixture = json.loads((Path(__file__).parent / "fixtures" / "bordermuse" / "conformance-v1.json").read_text())
        self.assertEqual(fixture["spec_id"], SPEC_ID)
        self.assertEqual(len(fixture["cases"]), 20)
        for case in fixture["cases"]:
            with self.subTest(file=case["source_file"]):
                self.assertEqual(asdict(calculate(**case["input"])), case["expected"])

    def test_fractional_margin_must_not_be_lost_to_float(self):
        # 100 * .14 / 2 is susceptible to landing below the integer 7.
        result = calculate(100, 100, 14, (1, 1))
        self.assertEqual((result.width, result.height, result.left), (114, 114, 7))

    def test_exact_formula_at_unmeasured_dimensions(self):
        # These are mathematical contract checks, not additional Mobile evidence.
        for w, h in [(1, 1), (997, 1499), (1201, 799), (6000, 4000), (10**12 + 1, 10**12 + 3)]:
            for t in [0, 1, 7, 14, 25, 50]:
                for rw, rh in [(1, 1), (5, 4), (9, 16), (2, 1), (w, h)]:
                    with self.subTest(size=(w, h), t=t, ratio=(rw, rh)):
                        r = Fraction(rw, rh)
                        scale = Fraction(100 + t, 100)
                        mx = (max(Fraction(w), h * r) * scale - w) // 2
                        my = (max(Fraction(h), w / r) * scale - h) // 2
                        actual = calculate(w, h, t, (rw, rh))
                        self.assertEqual(asdict(actual), dict(width=w + 2*mx, height=h + 2*my, left=mx, right=mx, top=my, bottom=my))

    def test_original_is_source_ratio(self):
        self.assertEqual(calculate(1201, 799, 7, None), calculate(1201, 799, 7, (1201, 799)))

    def test_invalid_inputs(self):
        for args in [(0, 10, 10, (1, 1)), (10, -1, 10, (1, 1)), (10, 10, 51, (1, 1)), (10, 10, -1, (1, 1)), (10, 10, 0.5, (1, 1)), (10, 10, 10, (0, 1)), (10, 10, 10, (1,)), (True, 10, 10, (1, 1))]:
            with self.subTest(args=args):
                with self.assertRaises(ValueError):
                    calculate(*args)


if __name__ == "__main__":
    unittest.main()
