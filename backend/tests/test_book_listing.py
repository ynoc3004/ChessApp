import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import main


class BookListingTests(unittest.TestCase):
    def test_list_returns_summary_without_positions(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / ("a" * 32)
            folder.mkdir()
            (folder / "book.json").write_text(json.dumps({
                "jobId": folder.name, "filename": "book.pdf", "count": 1,
                "positions": [{"id": 1, "imageUrl": "/files/example.png"}],
            }), encoding="utf-8")
            with patch.object(main, "OUTPUT_DIR", Path(directory)):
                summary = main.list_books()["books"][0]
                detail = main.get_book(folder.name)
            self.assertEqual(set(summary), {"jobId", "filename", "count", "updatedAt"})
            self.assertEqual(len(detail["positions"]), 1)
