import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import fitz
import cv2
from fastapi.testclient import TestClient

from app import main


class ManualDiagramTests(unittest.TestCase):
    def test_add_crop_to_existing_pdf_book(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            job_id = "b" * 32
            output = root / "positions" / job_id
            upload = root / "uploads"
            output.mkdir(parents=True)
            upload.mkdir()
            pdf = fitz.open()
            page = pdf.new_page(width=400, height=400)
            page.draw_rect(fitz.Rect(100, 100, 300, 300), color=(0, 0, 0), fill=(0, 0, 0))
            pdf.save(upload / f"{job_id}.pdf")
            pdf.close()
            (output / "book.json").write_text(json.dumps({"jobId": job_id, "filename": "sample.pdf", "count": 0, "positions": []}))
            (output / "status.json").write_text(json.dumps({"jobId": job_id, "status": "completed", "count": 0, "positions": []}))
            client = TestClient(main.app)
            with patch.object(main, "OUTPUT_DIR", root / "positions"), patch.object(main, "UPLOAD_DIR", upload):
                preview = client.get(f"/api/books/{job_id}/pages/1")
                response = client.post(f"/api/books/{job_id}/diagrams/manual", json={
                    "page": 1, "x0": .25, "y0": .25, "x1": .75, "y1": .75,
                })
                rejected = client.post(f"/api/books/{job_id}/diagrams/manual", json={
                    "page": 1, "x0": 0, "y0": 0, "x1": 2, "y1": 1,
                })
            self.assertEqual(preview.status_code, 200)
            self.assertEqual(preview.headers["content-type"], "image/png")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["count"], 1)
            self.assertEqual(response.json()["positions"][0]["page"], 1)
            self.assertTrue((output / "position-0001.png").exists())
            crop = cv2.imread(str(output / "position-0001.png"))
            self.assertEqual(crop.shape[:2], (400, 400))
            self.assertEqual(rejected.status_code, 400)
            self.assertEqual(json.loads((output / "status.json").read_text())["count"], 1)
