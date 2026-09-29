import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import main


class JobRecoveryTests(unittest.TestCase):
    def test_restart_marks_orphaned_jobs_failed_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, state in (("queued", "queued"), ("running", "processing"), ("done", "completed")):
                folder = root / name
                folder.mkdir()
                (folder / "status.json").write_text(json.dumps({"status": state, "jobId": name}))
            with patch.object(main, "OUTPUT_DIR", root):
                main.recover_interrupted_jobs()
            for name in ("queued", "running"):
                status = json.loads((root / name / "status.json").read_text())
                self.assertEqual(status["status"], "failed")
                self.assertIn("khởi động lại", status["error"])
            done = json.loads((root / "done" / "status.json").read_text())
            self.assertEqual(done["status"], "completed")
