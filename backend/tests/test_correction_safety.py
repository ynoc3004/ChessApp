import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app import main


class CorrectionSafetyTests(unittest.TestCase):
    def test_trial_move_never_creates_training_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            job_id = "a" * 32
            (root / job_id).mkdir()
            learning = root / "learning"
            learning.mkdir()
            with patch.object(main, "OUTPUT_DIR", root), patch.object(main, "LEARNING_DIR", learning):
                with self.assertRaises(HTTPException) as error:
                    main.save_corrected_position(
                        job_id, 1,
                        main.SavePositionRequest(
                            fen="4k3/8/8/8/8/8/8/4K3 b - - 0 1",
                            trialMove=True,
                        ),
                    )
            self.assertEqual(error.exception.status_code, 400)
            self.assertFalse((root / job_id / "position-0001.user.json").exists())
            self.assertEqual(list(learning.iterdir()), [])
