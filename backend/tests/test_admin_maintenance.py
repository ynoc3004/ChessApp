import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

from app import main
from app.admin_maintenance import create_backup, integrity_report, list_backups, prune_backups


class AdminMaintenanceTests(unittest.TestCase):
    def _database(self, path: Path, value: str = "ok") -> None:
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE sample (value TEXT)")
            db.execute("INSERT INTO sample VALUES (?)", (value,))
            db.commit()

    def test_maintenance_routes_are_registered(self):
        paths = set(main.app.openapi()["paths"])
        self.assertIn("/api/admin/maintenance", paths)
        self.assertIn("/api/admin/maintenance/backups", paths)
        self.assertIn("/api/admin/maintenance/backups/{backup_id}/download", paths)
        self.assertIn("/api/admin/maintenance/integrity", paths)

    def test_core_backup_excludes_puzzle_db_and_backup_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory) / "data"
            backups = data / "backups"
            data.mkdir()
            backups.mkdir()
            self._database(data / "collection.sqlite3")
            self._database(data / "lichess-puzzles.sqlite3", "puzzle")
            (data / "positions").mkdir()
            (data / "positions" / "book.json").write_text('{"count":1}', encoding="utf-8")
            (backups / "old.txt").write_text("must not be archived", encoding="utf-8")

            result = create_backup("core", data_dir=data, backup_dir=backups)
            archive_path = backups / result["filename"]

            with zipfile.ZipFile(archive_path) as archive:
                names = set(archive.namelist())
                manifest = json.loads(archive.read("manifest.json"))
                self.assertIn("data/collection.sqlite3", names)
                self.assertIn("data/positions/book.json", names)
                self.assertNotIn("data/lichess-puzzles.sqlite3", names)
                self.assertFalse(any(name.startswith("data/backups/") for name in names))
                self.assertFalse(manifest["includesPuzzleDb"])

                extracted = Path(directory) / "collection-snapshot.sqlite3"
                extracted.write_bytes(archive.read("data/collection.sqlite3"))
                with sqlite3.connect(extracted) as db:
                    self.assertEqual(db.execute("PRAGMA quick_check").fetchone()[0], "ok")
                    self.assertEqual(db.execute("SELECT value FROM sample").fetchone()[0], "ok")

    def test_full_backup_includes_puzzle_db_and_lists_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory) / "data"
            backups = data / "backups"
            data.mkdir()
            self._database(data / "lichess-puzzles.sqlite3", "puzzle")

            result = create_backup("full", data_dir=data, backup_dir=backups)
            rows = list_backups(backup_dir=backups)

            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["id"], result["id"])
            self.assertEqual(rows[0]["scope"], "full")
            self.assertTrue(rows[0]["includesPuzzleDb"])
            with zipfile.ZipFile(backups / result["filename"]) as archive:
                self.assertIn("data/lichess-puzzles.sqlite3", archive.namelist())

    def test_prune_keeps_newest_backups(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory) / "data"
            backups = data / "backups"
            data.mkdir()
            (data / "note.txt").write_text("backup", encoding="utf-8")
            for _ in range(3):
                create_backup("core", data_dir=data, backup_dir=backups)

            removed = prune_backups(2, backup_dir=backups)
            self.assertEqual(len(removed), 1)
            self.assertEqual(len(list_backups(backup_dir=backups)), 2)

    def test_integrity_report_flags_corrupt_existing_database(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            self._database(data / "collection.sqlite3")
            (data / "admin-users.sqlite3").write_bytes(b"not a sqlite database")

            report = integrity_report(data_dir=data)
            by_name = {item["name"]: item for item in report["databases"]}

            self.assertFalse(report["healthy"])
            self.assertEqual(report["checked"], 2)
            self.assertEqual(report["errors"], 1)
            self.assertEqual(by_name["collection.sqlite3"]["status"], "ok")
            self.assertEqual(by_name["admin-users.sqlite3"]["status"], "error")
            self.assertEqual(by_name["admin-audit.sqlite3"]["status"], "missing")


if __name__ == "__main__":
    unittest.main()
