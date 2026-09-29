import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from app import main


class ImageDownloadTests(unittest.TestCase):
    def test_download_uses_attachment_disposition(self):
        with tempfile.TemporaryDirectory() as directory:
            job_id = "a" * 32
            folder = Path(directory) / job_id
            folder.mkdir()
            content = b"png-bytes"
            (folder / "position-0001.png").write_bytes(content)
            with patch.object(main, "OUTPUT_DIR", Path(directory)):
                response = TestClient(main.app).get(f"/api/books/{job_id}/positions/1/download")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, content)
            self.assertIn("attachment", response.headers["content-disposition"])
            self.assertIn("position-0001.png", response.headers["content-disposition"])
