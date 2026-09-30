import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from app import admin_dataset, main


class AdminDatasetTests(unittest.TestCase):
    def _sample(self, root: Path, sample_id: str, *, ai_fen: str | None, corrected_fen: str, image: bool = True):
        payload = {
            "sampleId": sample_id,
            "jobId": sample_id[:32],
            "positionId": int(sample_id[-4:]),
            "image": f"{sample_id}.png",
            "correctedFen": corrected_fen,
            "aiFen": ai_fen,
            "recognizer": "book-cnn",
            "preprocessVariant": "contrast",
            "imageOrientation": "white-bottom",
            "savedAt": 123.0,
        }
        (root / f"{sample_id}.json").write_text(json.dumps(payload), encoding="utf-8")
        if image:
            (root / f"{sample_id}.png").write_bytes(b"png")

    def test_dataset_routes_are_registered(self):
        paths = set(main.app.openapi()["paths"])
        self.assertIn("/api/admin/dataset/stats", paths)
        self.assertIn("/api/admin/dataset/samples", paths)
        self.assertIn("/api/admin/dataset/export", paths)

    def test_fen_square_diff_reports_changed_squares(self):
        ai = "8/8/8/8/8/8/8/1K5k w - - 0 1"
        corrected = "8/8/8/8/8/8/8/K6k w - - 0 1"
        diffs = admin_dataset.fen_square_diff(ai, corrected)
        self.assertEqual(
            diffs,
            [
                {"square": "a1", "aiPiece": None, "correctedPiece": "K"},
                {"square": "b1", "aiPiece": "K", "correctedPiece": None},
            ],
        )

    def test_dataset_stats_counts_quality_and_square_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            changed_id = "a" * 32 + "-0001"
            confirmed_id = "b" * 32 + "-0002"
            missing_image_id = "c" * 32 + "-0003"
            corrected = "8/8/8/8/8/8/8/K6k w - - 0 1"
            self._sample(root, changed_id, ai_fen="8/8/8/8/8/8/8/1K5k w - - 0 1", corrected_fen=corrected)
            self._sample(root, confirmed_id, ai_fen=corrected, corrected_fen=corrected)
            self._sample(root, missing_image_id, ai_fen=None, corrected_fen=corrected, image=False)

            with patch.object(admin_dataset, "LEARNING_DIR", root):
                stats = admin_dataset.dataset_stats()

            self.assertEqual(stats["total"], 3)
            self.assertEqual(stats["changed"], 1)
            self.assertEqual(stats["confirmed"], 1)
            self.assertEqual(stats["missingAiFen"], 1)
            self.assertEqual(stats["missingImage"], 1)
            self.assertEqual(stats["averageChangedSquares"], 2)
            self.assertEqual(stats["topErrorSquares"][0]["count"], 1)
            self.assertEqual({item["square"] for item in stats["topErrorSquares"]}, {"a1", "b1"})

    def test_sample_filter_returns_only_changed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            corrected = "8/8/8/8/8/8/8/K6k w - - 0 1"
            self._sample(root, "a" * 32 + "-0001", ai_fen="8/8/8/8/8/8/8/1K5k w - - 0 1", corrected_fen=corrected)
            self._sample(root, "b" * 32 + "-0002", ai_fen=corrected, corrected_fen=corrected)

            with patch.object(admin_dataset, "LEARNING_DIR", root):
                result = admin_dataset.admin_dataset_samples(state="changed", query="", recognizer="", preprocess="", limit=100, offset=0)

            self.assertEqual(result["filtered"], 1)
            self.assertTrue(result["samples"][0]["changed"])

    def test_export_skips_samples_without_images(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            learning = root / "learning"
            learning.mkdir()
            export_path = root / "dataset.zip"
            corrected = "8/8/8/8/8/8/8/K6k w - - 0 1"
            good_id = "a" * 32 + "-0001"
            missing_id = "b" * 32 + "-0002"
            self._sample(learning, good_id, ai_fen=corrected, corrected_fen=corrected)
            self._sample(learning, missing_id, ai_fen=corrected, corrected_fen=corrected, image=False)

            with patch.object(admin_dataset, "LEARNING_DIR", learning), patch.object(admin_dataset, "DATA_DIR", root), patch.object(admin_dataset, "EXPORT_PATH", export_path):
                response = admin_dataset.admin_dataset_export(changed_only=False)

            self.assertEqual(Path(response.path), export_path)
            with zipfile.ZipFile(export_path) as archive:
                names = set(archive.namelist())
                self.assertIn("dataset.jsonl", names)
                self.assertIn("summary.json", names)
                self.assertIn(f"images/{good_id}.png", names)
                self.assertNotIn(f"images/{missing_id}.png", names)
                summary = json.loads(archive.read("summary.json"))
                self.assertEqual(summary["selected"], 2)
                self.assertEqual(summary["exported"], 1)
                self.assertEqual(summary["skipped"], 1)


if __name__ == "__main__":
    unittest.main()
