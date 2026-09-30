import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from app import main
from app import scanner_v2


class ScannerV2Tests(unittest.TestCase):
    def test_routes_are_registered(self):
        paths = set(main.app.openapi()["paths"])
        self.assertIn("/api/scanner/v2/start", paths)
        self.assertIn("/api/scanner/v2/jobs/{job_id}", paths)
        self.assertIn("/api/scanner/v2/jobs/{job_id}/pause", paths)
        self.assertIn("/api/scanner/v2/jobs/{job_id}/resume", paths)
        self.assertIn("/api/scanner/v2/jobs/{job_id}/retry-page", paths)
        self.assertIn("/api/scanner/v2/books/{job_id}/review", paths)

    def test_page_range_validation(self):
        self.assertEqual(scanner_v2._normalize_range(100, None, None), (1, 100))
        self.assertEqual(scanner_v2._normalize_range(100, 10, 20), (10, 20))
        self.assertEqual(scanner_v2._normalize_range(100, 10, None), (10, 100))
        with self.assertRaises(ValueError):
            scanner_v2._normalize_range(100, 20, 10)
        with self.assertRaises(ValueError):
            scanner_v2._normalize_range(100, 0, 10)
        with self.assertRaises(ValueError):
            scanner_v2._normalize_range(100, 1, 101)

    def test_page_timeout_config_is_clamped(self):
        with patch.dict("os.environ", {"CHESSAPP_SCANNER_PAGE_TIMEOUT": "2"}):
            self.assertEqual(scanner_v2._page_timeout_seconds(), 15.0)
        with patch.dict("os.environ", {"CHESSAPP_SCANNER_PAGE_TIMEOUT": "900"}):
            self.assertEqual(scanner_v2._page_timeout_seconds(), 600.0)
        with patch.dict("os.environ", {"CHESSAPP_SCANNER_PAGE_TIMEOUT": "bad"}):
            self.assertEqual(
                scanner_v2._page_timeout_seconds(),
                scanner_v2.DEFAULT_PAGE_TIMEOUT_SECONDS,
            )

    def test_scan_continues_after_page_failure_and_marks_review(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "positions"
            upload = root / "uploads"
            output.mkdir()
            upload.mkdir()
            job_id = "a" * 32
            job_dir = output / job_id
            job_dir.mkdir()
            source = upload / f"{job_id}.pdf"
            source.write_bytes(b"fake")
            image = np.zeros((180, 180, 3), dtype=np.uint8)

            def detect(_detector, _source, page, _job_dir, _status_path, _status):
                if page == 2:
                    raise scanner_v2.PageTimeoutError("page timed out")
                return [(image, 0.71 if page == 1 else 0.91)]

            with patch.object(scanner_v2, "OUTPUT_DIR", output), patch.object(
                scanner_v2, "UPLOAD_DIR", upload
            ), patch.object(scanner_v2, "_detect_page_guarded", side_effect=detect):
                scanner_v2._CONTROLS[job_id] = scanner_v2.JobControl()
                scanner_v2._scan_worker(job_id, source, "book.pdf", 1, 3, 3)

            status = json.loads((job_dir / "status.json").read_text(encoding="utf-8"))
            book = json.loads((job_dir / "book.json").read_text(encoding="utf-8"))
            self.assertEqual(status["status"], "completed")
            self.assertEqual(status["progress"], 100.0)
            self.assertEqual([item["page"] for item in status["failedPages"]], [2])
            self.assertIn("timed out", status["failedPages"][0]["error"])
            self.assertEqual(status["pageStates"]["1"], "completed")
            self.assertEqual(status["pageStates"]["2"], "failed")
            self.assertEqual(status["pageStates"]["3"], "completed")
            self.assertEqual(book["count"], 2)
            self.assertTrue(book["positions"][0]["needsReview"])
            self.assertFalse(book["positions"][1]["needsReview"])
            self.assertFalse(status["workerAlive"])

    def test_retry_worker_preserves_other_failed_pages(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "positions"
            output.mkdir()
            job_id = "d" * 32
            job_dir = output / job_id
            job_dir.mkdir()
            source = root / f"{job_id}.pdf"
            source.write_bytes(b"fake")
            (job_dir / "book.json").write_text(
                json.dumps({"jobId": job_id, "positions": []}), encoding="utf-8"
            )
            image = np.zeros((180, 180, 3), dtype=np.uint8)
            carry = [{"page": 9, "error": "another failure"}]

            def detect(_detector, _source, _page, _job_dir, _status_path, _status):
                return [(image, 0.9)]

            with patch.object(scanner_v2, "OUTPUT_DIR", output), patch.object(
                scanner_v2, "_detect_page_guarded", side_effect=detect
            ):
                scanner_v2._CONTROLS[job_id] = scanner_v2.JobControl()
                scanner_v2._scan_worker(
                    job_id,
                    source,
                    "book.pdf",
                    4,
                    4,
                    12,
                    preserve_existing=True,
                    carry_failed=carry,
                )

            status = json.loads((job_dir / "status.json").read_text(encoding="utf-8"))
            self.assertEqual(status["status"], "completed")
            self.assertEqual(status["failedPages"], carry)
            self.assertEqual(status["pageStates"]["4"], "completed")

    def test_dead_processing_job_is_marked_failed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "positions"
            output.mkdir()
            job_id = "e" * 32
            job_dir = output / job_id
            job_dir.mkdir()
            (job_dir / "status.json").write_text(
                json.dumps(
                    {
                        "jobId": job_id,
                        "scannerVersion": 2,
                        "status": "processing",
                        "phase": "detect",
                        "workerAlive": True,
                    }
                ),
                encoding="utf-8",
            )

            with patch.object(scanner_v2, "OUTPUT_DIR", output), patch.object(
                scanner_v2, "_worker_alive", return_value=False
            ):
                status = scanner_v2.get_job_v2(job_id)

            self.assertEqual(status["status"], "failed")
            self.assertFalse(status["workerAlive"])
            self.assertIn("không còn hoạt động", status["error"])

    def test_remove_page_positions_keeps_other_ids_and_deletes_related_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "positions"
            output.mkdir()
            job_id = "b" * 32
            job_dir = output / job_id
            job_dir.mkdir()
            book = {
                "jobId": job_id,
                "filename": "book.pdf",
                "count": 3,
                "positions": [
                    {"id": 1, "page": 1},
                    {"id": 2, "page": 2},
                    {"id": 7, "page": 3},
                ],
            }
            (job_dir / "book.json").write_text(json.dumps(book), encoding="utf-8")
            (job_dir / "position-0002.png").write_bytes(b"png")
            (job_dir / "position-0002.recognition.json").write_text("{}", encoding="utf-8")
            (job_dir / "position-0002.user.json").write_text("{}", encoding="utf-8")

            with patch.object(scanner_v2, "OUTPUT_DIR", output):
                kept = scanner_v2._remove_page_positions(job_id, 2)

            self.assertEqual([item["id"] for item in kept], [1, 7])
            self.assertFalse((job_dir / "position-0002.png").exists())
            self.assertFalse((job_dir / "position-0002.recognition.json").exists())
            saved = json.loads((job_dir / "book.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["count"], 2)
            self.assertEqual([item["id"] for item in saved["positions"]], [1, 7])

    def test_review_queue_orders_low_confidence_first(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "positions"
            output.mkdir()
            job_id = "c" * 32
            job_dir = output / job_id
            job_dir.mkdir()
            (job_dir / "book.json").write_text(
                json.dumps(
                    {
                        "positions": [
                            {
                                "id": 1,
                                "page": 1,
                                "confidence": 0.74,
                                "needsReview": True,
                            },
                            {
                                "id": 2,
                                "page": 2,
                                "confidence": 0.93,
                                "needsReview": False,
                            },
                            {
                                "id": 3,
                                "page": 3,
                                "confidence": 0.61,
                                "needsReview": True,
                            },
                        ]
                    }
                ),
                encoding="utf-8",
            )
            with patch.object(scanner_v2, "OUTPUT_DIR", output):
                payload = scanner_v2.review_queue_v2(job_id)
            self.assertEqual(payload["count"], 2)
            self.assertEqual([item["id"] for item in payload["positions"]], [3, 1])


if __name__ == "__main__":
    unittest.main()
