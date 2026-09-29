import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app import admin, main


class AdminTests(unittest.TestCase):
    def test_admin_routes_are_registered(self):
        paths = {route.path for route in main.app.routes}
        self.assertIn("/api/admin/session", paths)
        self.assertIn("/api/admin/stats", paths)
        self.assertIn("/api/admin/books", paths)

    def test_admin_token_is_required(self):
        with patch.dict(os.environ, {"CHESSAPP_ADMIN_TOKEN": "secret"}, clear=False):
            admin.require_admin("Bearer secret")
            with self.assertRaises(HTTPException) as context:
                admin.require_admin("Bearer wrong")
            self.assertEqual(context.exception.status_code, 401)

    def test_collect_books_reads_completed_and_failed_jobs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "positions"
            uploads = root / "uploads"
            output.mkdir()
            uploads.mkdir()

            completed = output / ("a" * 32)
            completed.mkdir()
            (completed / "book.json").write_text(json.dumps({
                "jobId": completed.name,
                "filename": "done.pdf",
                "count": 3,
                "positions": [],
            }), encoding="utf-8")
            (uploads / f"{completed.name}.pdf").write_bytes(b"pdf")

            failed = output / ("b" * 32)
            failed.mkdir()
            (failed / "status.json").write_text(json.dumps({
                "jobId": failed.name,
                "filename": "bad.pdf",
                "status": "failed",
                "progress": 25,
                "count": 1,
                "error": "boom",
            }), encoding="utf-8")

            with patch.object(admin, "OUTPUT_DIR", output), patch.object(admin, "UPLOAD_DIR", uploads):
                books = admin.collect_books()

            by_id = {item["jobId"]: item for item in books}
            self.assertEqual(by_id[completed.name]["status"], "completed")
            self.assertEqual(by_id[completed.name]["count"], 3)
            self.assertEqual(by_id[failed.name]["status"], "failed")
            self.assertEqual(by_id[failed.name]["error"], "boom")

    def test_puzzle_stats_reads_database(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "puzzles.sqlite3"
            with sqlite3.connect(database) as db:
                db.executescript("""
                    CREATE TABLE puzzles (id TEXT PRIMARY KEY, fen TEXT, moves TEXT, rating INTEGER, themes TEXT);
                    CREATE TABLE themes (theme TEXT, rating INTEGER, id TEXT, PRIMARY KEY(theme,id));
                """)
                db.executemany(
                    "INSERT INTO puzzles VALUES (?,?,?,?,?)",
                    [
                        ("one", "fen", "a2a3 a7a6", 1000, "fork"),
                        ("two", "fen", "a2a3 a7a6", 1400, "fork pin"),
                    ],
                )
                db.executemany(
                    "INSERT INTO themes VALUES (?,?,?)",
                    [("fork", 1000, "one"), ("fork", 1400, "two"), ("pin", 1400, "two")],
                )
                db.commit()

            with patch.object(admin, "PUZZLES_DB", database), patch.object(admin, "PUZZLES_SOURCE", Path(directory) / "missing.json"):
                stats = admin.puzzle_stats()

            self.assertTrue(stats["ready"])
            self.assertEqual(stats["count"], 2)
            self.assertEqual(stats["ratingMin"], 1000)
            self.assertEqual(stats["ratingMax"], 1400)
            self.assertEqual(stats["themeCount"], 2)
            self.assertEqual(stats["topThemes"][0], {"theme": "fork", "count": 2})


if __name__ == "__main__":
    unittest.main()
