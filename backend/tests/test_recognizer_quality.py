import unittest

from app import recognizer


VALID_PLACEMENT = "4k3/8/8/8/8/8/8/4K3"
MISSING_BLACK_KING = "8/8/8/8/8/8/8/4K3"
TOO_MANY_WHITE_PAWNS = "4k3/8/8/8/8/PPPPPPPP/PP6/4K3"


class RecognitionQualityTests(unittest.TestCase):
    def test_valid_position_outranks_missing_king(self):
        valid = recognizer.placement_quality(VALID_PLACEMENT)
        invalid = recognizer.placement_quality(MISSING_BLACK_KING)

        self.assertTrue(valid["valid"])
        self.assertFalse(invalid["valid"])
        self.assertGreater(valid["score"], invalid["score"])
        self.assertIn("black-kings:0", invalid["reasons"])

    def test_impossible_piece_counts_are_penalized(self):
        quality = recognizer.placement_quality(TOO_MANY_WHITE_PAWNS)
        self.assertFalse(quality["valid"])
        self.assertTrue(any(reason.startswith("white-pawns:") for reason in quality["reasons"]))

    def test_fusion_uses_square_consensus_and_can_restore_valid_board(self):
        confidence = {
            f"{file}{rank}": 0.92
            for rank in range(1, 9)
            for file in "abcdefgh"
        }

        def result(placement, quality, variant):
            return {
                "piecePlacement": placement,
                "suggestedOrientation": "white",
                "squareConfidence": confidence,
                "placementQuality": quality,
                "qualityScore": 1.0 + quality * 0.1,
                "averageConfidence": 0.92,
                "uncertainSquares": [],
                "preprocessVariant": variant,
            }

        fused = recognizer._fuse_results([
            result(VALID_PLACEMENT, 5.7, "contrast"),
            result(VALID_PLACEMENT, 5.7, "dehatch"),
            result(MISSING_BLACK_KING, -2.0, "original"),
        ])

        self.assertIsNotNone(fused)
        assert fused is not None
        self.assertEqual(fused["piecePlacement"], VALID_PLACEMENT)
        self.assertTrue(fused["validPlacement"])
        self.assertEqual(fused["preprocessVariant"], "ensemble")


if __name__ == "__main__":
    unittest.main()
