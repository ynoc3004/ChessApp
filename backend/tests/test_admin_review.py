import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import admin
from app.admin_review import _diff_kind, _risk, correction_stats


class RecognitionReviewTests(unittest.TestCase):
    def test_pending_position_is_highest_risk(self):
        score, reasons = _risk({"recognized": False, "corrected": False})
        self.assertEqual(score, 100.0)
        self.assertIn("Chưa nhận dạng AI", reasons)

    def test_corrected_position_is_zero_risk(self):
        score, reasons = _risk({"recognized": True, "corrected": True})
        self.assertEqual(score, 0.0)
        self.assertTrue(reasons)

    def test_risk_combines_invalid_low_confidence_and_uncertain_squares(self):
        score, reasons = _risk({
            "recognized": True,
            "corrected": False,
            "averageConfidence": 0.61,
            "uncertainSquares": ["a1", "b2", "c3"],
            "validPlacement": False,
            "pieceColorMismatchCount": 2,
            "specialistUncertainCount": 3,
            "specialistCorrectedCount": 1,
        })
        self.assertGreater(score, 60)
        self.assertTrue(any("FEN" in reason for reason in reasons))
        self.assertTrue(any("sai màu" in reason for reason in reasons))
        self.assertTrue(any("model loại quân" in reason for reason in reasons))

    def test_diff_kind_separates_occupancy_color_and_type(self):
        self.assertEqual(_diff_kind(None, "P"), "occupancy")
        self.assertEqual(_diff_kind("p", "P"), "color")
        self.assertEqual(_diff_kind("R", "Q"), "type")

    def test_correction_stats_counts_error_families(self):
        with tempfile.TemporaryDirectory() as directory:
            learning = Path(directory)
            payload = {
                "sampleId": "a" * 32 + "-0001",
                "aiFen": "4k3/8/8/8/8/8/4p3/4K3 w - - 0 1",
                "correctedFen": "4k3/8/8/8/8/8/4P3/3RK3 w - - 0 1",
            }
            (learning / "sample.json").write_text(json.dumps(payload), encoding="utf-8")
            with patch("app.admin_review.admin_core.LEARNING_DIR", learning):
                stats = correction_stats()

            self.assertEqual(stats["boardsWithCorrections"], 1)
            self.assertEqual(stats["colorErrors"], 1)
            self.assertEqual(stats["occupancyErrors"], 1)
            self.assertEqual(stats["typeErrors"], 0)
            self.assertEqual(stats["correctedSquares"], 2)

    def test_review_routes_registered(self):
        paths = {getattr(route, "path", "") for route in admin.router.routes}
        self.assertIn("/api/admin/review/queue", paths)
        self.assertIn("/api/admin/review/batch", paths)
        self.assertIn("/api/admin/review/{job_id}/{position_id}/confirm", paths)


if __name__ == "__main__":
    unittest.main()
