import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import admin, admin_books, main


class AdminBookCrudTests(unittest.TestCase):
    def test_routes_are_registered(self):
        paths = set(main.app.openapi()["paths"])
        self.assertIn("/api/admin/books/{job_id}", paths)
        self.assertIn("/api/admin/books/{job_id}/rescan", paths)
        self.assertIn("/api/admin/books/{job_id}/recognition-cache", paths)
        self.assertIn("/api/admin/books/{job_id}/positions/{position_id}", paths)

    def test_book_detail_reports_recognition_states(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "positions"
            uploads = root / "uploads"
            output.mkdir()
            uploads.mkdir()
            job_id = "a" * 32
            job = output / job_id
            job.mkdir()
            source = uploads / f"{job_id}.pdf"
            source.write_bytes(b"pdf")
            positions = [
                {"id": 1, "page": 3, "confidence": 0.9, "imageUrl": f"/files/{job_id}/position-0001.png"},
                {"id": 2, "page": 8, "confidence": 0.8, "imageUrl": f"/files/{job_id}/position-0002.png"},
                {"id": 3, "page": 10, "confidence": 0.7, "imageUrl": f"/files/{job_id}/position-0003.png"},
            ]
            (job / "book.json").write_text(json.dumps({"jobId": job_id, "filename": "book.pdf", "count": 3, "positions": positions}), encoding="utf-8")
            (job / "status.json").write_text(json.dumps({"status": "completed", "progress": 100, "positions": positions}), encoding="utf-8")
            for number in (1, 2, 3):
                (job / f"position-{number:04d}.png").write_bytes(b"image")
            (job / "position-0001.recognition.json").write_text(json.dumps({"fen": "8/8/8/8/8/8/8/K6k w - - 0 1", "averageConfidence": 0.91}), encoding="utf-8")
            (job / "position-0002.user.json").write_text(json.dumps({"fen": "8/8/8/8/8/8/8/K6k w - - 0 1", "savedAt": 123}), encoding="utf-8")

            with patch.object(admin_books, "OUTPUT_DIR", output), patch.object(admin, "UPLOAD_DIR", uploads):
                detail = admin_books.book_detail(job_id)

            self.assertEqual(detail["stats"]["recognized"], 1)
            self.assertEqual(detail["stats"]["corrected"], 1)
            self.assertEqual(detail["stats"]["pending"], 1)
            self.assertEqual(detail["positions"][0]["state"], "recognized")
            self.assertEqual(detail["positions"][1]["state"], "corrected")
            self.assertEqual(detail["positions"][2]["state"], "pending")
            self.assertTrue(detail["source"]["available"])

    def test_clear_cache_keeps_user_correction(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            job_id = "b" * 32
            job = output / job_id
            job.mkdir()
            (job / "status.json").write_text(json.dumps({"status": "completed"}), encoding="utf-8")
            (job / "position-0001.recognition.json").write_text("{}", encoding="utf-8")
            (job / "position-0001.contrast.png").write_bytes(b"variant")
            (job / "position-0001.binary.png").write_bytes(b"variant")
            correction = job / "position-0001.user.json"
            correction.write_text(json.dumps({"fen": "saved"}), encoding="utf-8")

            with patch.object(admin_books, "OUTPUT_DIR", output):
                result = admin_books.admin_clear_recognition_cache(job_id)

            self.assertEqual(result["removed"]["recognition"], 1)
            self.assertEqual(result["removed"]["variants"], 2)
            self.assertTrue(correction.exists())

    def test_delete_position_updates_metadata_without_renumbering(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            job_id = "c" * 32
            job = output / job_id
            job.mkdir()
            positions = [
                {"id": 1, "page": 1},
                {"id": 2, "page": 2},
                {"id": 4, "page": 4},
            ]
            (job / "book.json").write_text(json.dumps({"jobId": job_id, "count": 3, "positions": positions}), encoding="utf-8")
            (job / "status.json").write_text(json.dumps({"status": "completed", "count": 3, "positions": positions}), encoding="utf-8")
            (job / "position-0002.png").write_bytes(b"image")
            (job / "position-0002.recognition.json").write_text("{}", encoding="utf-8")
            (job / "chess-diagrams.zip").write_bytes(b"zip")

            with patch.object(admin_books, "OUTPUT_DIR", output):
                result = admin_books.admin_delete_position(job_id, 2)

            saved = json.loads((job / "book.json").read_text(encoding="utf-8"))
            self.assertEqual(result["count"], 2)
            self.assertEqual([item["id"] for item in saved["positions"]], [1, 4])
            self.assertFalse((job / "position-0002.png").exists())
            self.assertFalse((job / "chess-diagrams.zip").exists())

    def test_rescan_resets_job_and_starts_existing_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "positions"
            uploads = root / "uploads"
            output.mkdir()
            uploads.mkdir()
            job_id = "d" * 32
            job = output / job_id
            job.mkdir()
            source = uploads / f"{job_id}.pdf"
            source.write_bytes(b"pdf")
            (job / "book.json").write_text(json.dumps({"jobId": job_id, "filename": "original.pdf", "count": 1, "positions": [{"id": 1}]}), encoding="utf-8")
            (job / "status.json").write_text(json.dumps({"status": "failed", "error": "boom"}), encoding="utf-8")
            (job / "position-0001.png").write_bytes(b"old")

            with patch.object(admin_books, "OUTPUT_DIR", output), patch.object(admin, "UPLOAD_DIR", uploads), patch.object(admin_books, "_start_scan") as start:
                result = admin_books.admin_rescan_book(job_id)

            self.assertEqual(result["status"], "queued")
            self.assertFalse((job / "position-0001.png").exists())
            queued = json.loads((job / "status.json").read_text(encoding="utf-8"))
            self.assertEqual(queued["filename"], "original.pdf")
            start.assert_called_once_with(job_id, source, ".pdf", "original.pdf")


if __name__ == "__main__":
    unittest.main()
