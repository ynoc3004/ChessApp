import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from app.preprocess import analyze_board_vision, ensure_book_variants


class BoardVisionTests(unittest.TestCase):
    def _old_book_board(self, path: Path) -> set[str]:
        size = 512
        margin = 12
        board_size = size - margin * 2
        cell = board_size // 8
        image = np.full((size, size), 255, dtype=np.uint8)

        # Thick printed frame, like the historical diagrams used by ChessApp.
        cv2.rectangle(
            image,
            (margin, margin),
            (margin + board_size, margin + board_size),
            0,
            4,
        )

        # Alternating diagonal hatch texture. These lines should NOT be treated
        # as chess pieces by the non-diagonal-gradient occupancy detector.
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

        occupied = {
            "b8": (0, 1),
            "d7": (1, 3),
            "a5": (3, 0),
            "e3": (5, 4),
            "h1": (7, 7),
        }
        for _square, (row, col) in occupied.items():
            cx = margin + col * cell + cell // 2
            cy = margin + row * cell + cell // 2
            # Piece-like silhouette with strong vertical/horizontal/curved
            # contours, deliberately independent from diagonal hatch lines.
            cv2.circle(image, (cx, cy - 8), 10, 0, 3)
            cv2.rectangle(image, (cx - 9, cy + 2), (cx + 9, cy + 16), 0, -1)
            cv2.line(image, (cx - 15, cy + 19), (cx + 15, cy + 19), 0, 4)

        cv2.imwrite(str(path), image)
        return set(occupied)

    def test_old_book_hatch_does_not_hide_occupied_squares(self):
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "position-0001.png"
            expected = self._old_book_board(image_path)
            vision = analyze_board_vision(image_path)

            detected = set(vision["occupiedSquares"])
            self.assertTrue(expected.issubset(detected), (expected, detected))
            self.assertLessEqual(len(detected - expected), 2)
            for square in expected:
                self.assertGreaterEqual(vision["occupancy"][square], 0.5)

    def test_grid_variants_are_generated_for_recognition(self):
        with tempfile.TemporaryDirectory() as directory:
            image_path = Path(directory) / "position-0001.png"
            self._old_book_board(image_path)
            variants = ensure_book_variants(image_path)

            self.assertIn("grid", variants)
            self.assertIn("grid-contrast", variants)
            grid = cv2.imread(str(variants["grid"]), cv2.IMREAD_GRAYSCALE)
            self.assertIsNotNone(grid)
            self.assertEqual(grid.shape, (512, 512))


if __name__ == "__main__":
    unittest.main()
