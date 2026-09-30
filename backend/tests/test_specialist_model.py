import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from app.specialist_model import (
    CLASSES,
    apply_specialist_types,
    predict_board,
    specialist_status,
    train_specialist_model,
)


class SpecialistModelTests(unittest.TestCase):
    def _board_image(self, path: Path, shift: int = 0) -> None:
        size = 512
        margin = 12
        board_size = size - margin * 2
        cell = board_size // 8
        image = np.full((size, size), 255, dtype=np.uint8)
        cv2.rectangle(image, (margin, margin), (margin + board_size, margin + board_size), 0, 4)

        # Light historical hatch texture so training exercises the same input
        # normalization used for scanned chess books.
        for row in range(8):
            for col in range(8):
                if (row + col) % 2 == 0:
                    continue
                x0 = margin + col * cell
                y0 = margin + row * cell
                for offset in range(-cell, cell * 2, 11):
                    cv2.line(
                        image,
                        (x0 + max(0, offset), y0 + max(0, -offset)),
                        (x0 + min(cell, offset + cell), y0 + min(cell, cell - offset)),
                        150,
                        1,
                    )

        # FEN: black king e8, black queen d5, white pawn e3, white king e1.
        pieces = {
            (0, 4): "k",
            (3, 3): "q",
            (5, 4): "P",
            (7, 4): "K",
        }
        for (row, col), label in pieces.items():
            cx = margin + col * cell + cell // 2 + shift
            cy = margin + row * cell + cell // 2
            # Use deliberately distinct glyph-like silhouettes. The test is
            # about the learned pipeline, not a handcrafted chess font.
            if label.lower() == "q":
                cv2.circle(image, (cx, cy), 17, 0, 4)
                cv2.line(image, (cx - 18, cy + 18), (cx + 18, cy + 18), 0, 5)
                cv2.line(image, (cx, cy - 17), (cx, cy + 15), 0, 3)
            elif label.lower() == "p":
                cv2.circle(image, (cx, cy - 8), 9, 0, -1)
                cv2.rectangle(image, (cx - 7, cy + 1), (cx + 7, cy + 16), 0, -1)
            else:
                cv2.rectangle(image, (cx - 14, cy - 17), (cx + 14, cy + 17), 0, 3)
                cv2.line(image, (cx - 10, cy), (cx + 10, cy), 0, 3)
                if label.islower():
                    cv2.line(image, (cx, cy - 13), (cx, cy + 13), 0, 3)

        cv2.imwrite(str(path), image)

    def _write_sample(self, learning: Path, index: int) -> None:
        sample_id = f"{'a' * 31}{index:x}-{index:04d}"
        image_name = f"{sample_id}.png"
        self._board_image(learning / image_name, shift=index - 1)
        metadata = {
            "sampleId": sample_id,
            "image": image_name,
            "correctedFen": "4k3/8/8/3q4/8/4P3/8/4K3 w - - 0 1",
            "imageOrientation": "white",
        }
        (learning / f"{sample_id}.json").write_text(json.dumps(metadata), encoding="utf-8")

    def test_train_and_predict_thirteen_class_specialist(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            learning = root / "learning"
            learning.mkdir()
            for index in range(1, 4):
                self._write_sample(learning, index)

            model_path = root / "piece-specialist.npz"
            meta_path = root / "piece-specialist.json"
            metadata = train_specialist_model(learning, model_path, meta_path)

            self.assertTrue(model_path.exists())
            self.assertEqual(len(CLASSES), 13)
            self.assertEqual(metadata["boards"], 3)
            self.assertGreaterEqual(metadata["classCounts"]["q"], 3)
            self.assertGreaterEqual(metadata["classCounts"]["P"], 3)

            first_image = next(learning.glob("*.png"))
            predictions = predict_board(first_image, "white", model_path)
            self.assertIsNotNone(predictions)
            assert predictions is not None
            self.assertEqual(predictions["d5"]["type"], "Q")
            self.assertEqual(predictions["e3"]["type"], "P")
            self.assertGreater(predictions["d5"]["typeConfidence"], 0.5)

            status = specialist_status(learning, model_path, meta_path)
            self.assertTrue(status["modelExists"])
            self.assertTrue(status["ready"])
            self.assertFalse(status["stale"])

    def test_type_correction_preserves_piece_color_and_occupancy(self):
        result = {
            "piecePlacement": "4k3/8/8/8/8/8/4R3/4K3",
            "suggestedOrientation": "white",
            "averageConfidence": 0.82,
            "qualityScore": 2.0,
            "uncertainSquares": [],
            "candidates": {
                "whiteBottom": "4k3/8/8/8/8/8/4R3/4K3",
                "blackBottom": "3K4/3R4/8/8/8/8/8/3k4",
            },
        }
        predictions = {
            "e2": {"type": "Q", "typeConfidence": 0.91, "typeMargin": 0.32},
            "e1": {"type": "K", "typeConfidence": 0.95, "typeMargin": 0.5},
            "e8": {"type": "K", "typeConfidence": 0.94, "typeMargin": 0.49},
        }
        corrected = apply_specialist_types(result, predictions)

        self.assertEqual(corrected["piecePlacement"], "4k3/8/8/8/8/8/4Q3/4K3")
        self.assertEqual(corrected["specialistCorrectedSquares"], ["e2"])
        # White rook became a white queen: type changed, color did not.
        self.assertIn("Q", corrected["piecePlacement"])
        self.assertNotIn("R", corrected["piecePlacement"])
        self.assertEqual(sum(ch.isalpha() for ch in corrected["piecePlacement"]), 3)


if __name__ == "__main__":
    unittest.main()
