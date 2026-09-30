import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from app import main
from app.admin_maintenance import create_backup
from app.admin_restore import (
    RestoreApplyError,
    RestoreValidationError,
    build_restore_plan,
    restore_backup,
)


class AdminRestoreTests(unittest.TestCase):
    def _auth_database(self, path: Path, sessions: int = 1) -> None:
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE admin_users (id TEXT PRIMARY KEY)")
            db.execute("CREATE TABLE admin_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT)")
            db.execute("INSERT INTO admin_users VALUES ('owner')")
            for index in range(sessions):
                db.execute("INSERT INTO admin_sessions VALUES (?, 'owner')", (f"token-{index}",))
            db.commit()

    def test_restore_routes_are_registered(self):
        paths = set(main.app.openapi()["paths"])
        self.assertIn("/api/admin/maintenance/backups/{backup_id}/restore-plan", paths)
        self.assertIn("/api/admin/maintenance/backups/{backup_id}/restore", paths)

    def test_restore_plan_is_dry_run_and_core_preserves_puzzle_db(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory) / "data"
            backups = data / "backups"
            data.mkdir()
            (data / "note.txt").write_text("snapshot", encoding="utf-8")
            self._auth_database(data / "admin-users.sqlite3")
            result = create_backup("core", data_dir=data, backup_dir=backups)

            (data / "note.txt").write_text("current", encoding="utf-8")
            (data / "new-after-backup.txt").write_text("new", encoding="utf-8")
            (data / "lichess-puzzles.sqlite3").write_text("preserve me", encoding="utf-8")

            plan = build_restore_plan(result["id"], data_dir=data, backup_dir=backups)

            self.assertEqual(plan["scope"], "core")
            self.assertTrue(plan["valid"])
            self.assertTrue(plan["willResetAdminSessions"])
            self.assertFalse(plan["includesPuzzleDb"])
            self.assertEqual(plan["removeFiles"], 1)
            self.assertIn("new-after-backup.txt", plan["removePreview"])
            self.assertEqual((data / "note.txt").read_text(encoding="utf-8"), "current")
            self.assertEqual((data / "lichess-puzzles.sqlite3").read_text(encoding="utf-8"), "preserve me")

    def test_restore_applies_snapshot_creates_prebackup_and_revokes_sessions(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory) / "data"
            backups = data / "backups"
            data.mkdir()
            (data / "note.txt").write_text("snapshot", encoding="utf-8")
            self._auth_database(data / "admin-users.sqlite3", sessions=2)
            target = create_backup("core", data_dir=data, backup_dir=backups)

            (data / "note.txt").write_text("current", encoding="utf-8")
            (data / "remove-me.txt").write_text("remove", encoding="utf-8")
            puzzle = data / "lichess-puzzles.sqlite3"
            puzzle.write_text("keep puzzle", encoding="utf-8")

            with patch("app.admin_restore.safe_record_event", return_value=True):
                result = restore_backup(target["id"], data_dir=data, backup_dir=backups)

            self.assertTrue(result["restored"])
            self.assertTrue(result["sessionsRevoked"])
            self.assertTrue((backups / result["preRestoreBackup"]["filename"]).exists())
            self.assertEqual((data / "note.txt").read_text(encoding="utf-8"), "snapshot")
            self.assertFalse((data / "remove-me.txt").exists())
            self.assertEqual(puzzle.read_text(encoding="utf-8"), "keep puzzle")
            with sqlite3.connect(data / "admin-users.sqlite3") as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM admin_sessions").fetchone()[0], 0)

    def test_restore_rejects_path_traversal_before_touching_data(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory) / "data"
            backups = data / "backups"
            data.mkdir()
            backups.mkdir()
            backup_id = "aaaaaaaaaaaa"
            archive_path = backups / f"chessapp-backup-20260930-000000-core-{backup_id}.zip"
            manifest = {
                "format": "chessapp-admin-backup-v1",
                "createdAt": 1,
                "scope": "core",
                "backupId": backup_id,
                "fileCount": 1,
                "contentBytes": 4,
                "entries": [{"path": "data/../evil.txt", "bytes": 4}],
            }
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("data/../evil.txt", "evil")
                archive.writestr("manifest.json", json.dumps(manifest))

            with self.assertRaises(RestoreValidationError):
                build_restore_plan(backup_id, data_dir=data, backup_dir=backups)
            self.assertFalse((Path(directory) / "evil.txt").exists())

    def test_failed_apply_rolls_back_to_pre_restore_state(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory) / "data"
            backups = data / "backups"
            data.mkdir()
            (data / "note.txt").write_text("old snapshot", encoding="utf-8")
            target = create_backup("core", data_dir=data, backup_dir=backups)
            (data / "note.txt").write_text("current state", encoding="utf-8")

            def fail_after_mutation(staging, data_root, scope, restore_paths):
                del staging, scope, restore_paths
                (data_root / "note.txt").write_text("half restored", encoding="utf-8")
                raise OSError("simulated apply failure")

            with patch("app.admin_restore.safe_record_event", return_value=True):
                with self.assertRaises(RestoreApplyError) as raised:
                    restore_backup(
                        target["id"],
                        data_dir=data,
                        backup_dir=backups,
                        apply_func=fail_after_mutation,
                    )

            self.assertTrue(raised.exception.rollback_ok)
            self.assertEqual((data / "note.txt").read_text(encoding="utf-8"), "current state")
            self.assertIsNotNone(raised.exception.pre_backup)


if __name__ == "__main__":
    unittest.main()
