import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.env import load_env_file


class EnvLoaderTests(unittest.TestCase):
    def test_loads_backend_env_values(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text(
                "# comment\nCHESSAPP_ADMIN_TOKEN=secret-value\nQUOTED=\"hello world\"\n",
                encoding="utf-8",
            )
            with patch.dict(os.environ, {}, clear=True):
                loaded = load_env_file(env_file)
                self.assertEqual(os.environ["CHESSAPP_ADMIN_TOKEN"], "secret-value")
                self.assertEqual(os.environ["QUOTED"], "hello world")
                self.assertEqual(loaded["CHESSAPP_ADMIN_TOKEN"], "secret-value")

    def test_process_environment_has_priority(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text("CHESSAPP_ADMIN_TOKEN=file-secret\n", encoding="utf-8")
            with patch.dict(os.environ, {"CHESSAPP_ADMIN_TOKEN": "process-secret"}, clear=True):
                loaded = load_env_file(env_file)
                self.assertEqual(os.environ["CHESSAPP_ADMIN_TOKEN"], "process-secret")
                self.assertNotIn("CHESSAPP_ADMIN_TOKEN", loaded)

    def test_missing_env_file_is_safe(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing.env"
            with patch.dict(os.environ, {}, clear=True):
                self.assertEqual(load_env_file(missing), {})


if __name__ == "__main__":
    unittest.main()
