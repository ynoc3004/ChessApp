import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from app.color_vision import analyze_piece_colors
from app.recognizer import _apply_color_resolution


class PieceColorVisionTests(unittest.TestCase):
    def _board(self, path: Path) -> None:
        size = 512
        margin = 12
        board_size = size - margin * 2
        cell = board_size // 8
        image = np.full((size, size), 255, dtype=np.uint8)
        cv2.rectangle(image, (margin, margin), (margin + board_size, margin + board_size), 0, 4)

        # Historical diagonal hatch on alternating dark squares.
        for row in range(8):
            for col in range(8):
                if (row + col) % 2 == 0:
                    continue
                x0 = margin + col * cell
                y0 = margin + row * cell
                for offset in range(-cell, cell * 2, 10):
                    cv2.line(
                        image,
                        (x0 + max(0, offset), y0 + max(0, -offset)),
                        (x0 + min(cell, offset + cell), y0 + min(cell, cell - offset)),
                        120,
                        1,
                    )

        def center(row: int, col: int) -> tuple[int, int]:
            return (
                margin + col * cell + cell // 2,
                margin + row * cell + cell // 2,
            )

        # b8 / d5 are solid black-piece silhouettes.
        for row, col in ((0, 1), (3, 3)):
            cx, cy = center(row, col)
            cv2.circle(image, (cx, cy - 9), 10, 0, -1)
            cv2.rectangle(image, (cx - 11, cy), (cx + 11, cy + 17), 0, -1)
            cv2.line(image, (cx - 16, cy + 20), (cx + 16, cy + 20), 0, 4)

        # e3 / g1 are outlined white-piece silhouettes with light interiors.
        # Both deliberately sit on hatched squares to make sure background ink
        # is not mistaken for black-piece fill.
        for row, col in ((5, 4), (7, 6)):
            cx, cy = center(row, col)
            cv2.circle(image, (cx, cy - 9), 10, 0, 3)
            cv2.rectangle(image, (cx - 11, cy), (cx + 11, cy + 17), 0, 3)
            cv2.line(image, (cx - 16, cy + 20), (cx + 16, cy + 20), 0, 4)

        cv2.imwrite(str(path), image)

    def test_solid_black_and_outline_white_separate_on_hatched_board(self):
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "position-0001.png"
            self._board(image_path)
            vision = analyze_piece_colors(image_path)

            black = [vision["blackProbability"][square] for square in ("b8", "d5")]
            white = [vision["blackProbability"][square] for square in ("e3", "g1")]
            self.assertGreater(sum(black) / len(black), sum(white) / len(white) + 0.18)
            self.assertEqual(vision["method"], "connected-mass-holes-v4")

    def test_color_resolver_flips_case_without_changing_piece_type(self):
        result = {
            "piecePlacement": "4k3/8/8/8/8/8/4P3/4K3",
            "suggestedOrientation": "white",
            "averageConfidence": 0.84,
            "uncertainSquares": [],
            "candidates": {
                "whiteBottom": "4k3/8/8/8/8/8/4P3/4K3",
                "blackBottom": "3K4/3P4/8/8/8/8/8/3k4",
            },
            "warnings": [],
            "validPlacement": True,
            "placementQuality": 5.0,
            "qualityScore": 2.0,
            "qualityReasons": [],
        }
        color_vision = {
            "method": "connected-mass-holes-v4",
            "blackProbability": {"e2": 0.94, "e1": 0.05, "e8": 0.96},
            "colorConfidence": {"e2": 0.88, "e1": 0.9, "e8": 0.92},
        }

        corrected = _apply_color_resolution(result, color_vision)
        self.assertIn("e2", corrected["colorCorrectedSquares"])
        self.assertEqual(corrected["piecePlacement"], "4k3/8/8/8/8/8/4p3/4K3")
        # Type remains a pawn; only case/color changes.
        self.assertNotIn("P", corrected["piecePlacement"].split("/")[6])
        self.assertIn("p", corrected["piecePlacement"].split("/")[6])
        self.assertGreater(corrected["pieceColorAgreement"], 0.8)


if __name__ == "__main__":
    unittest.main()
