import tempfile
import unittest
import zipfile
from pathlib import Path

from app.book_files import ensure_diagrams_zip, original_diagram_pngs


class DiagramZipTests(unittest.TestCase):
    def test_zip_contains_only_originals_and_cache_ignores_variants(self):
        with tempfile.TemporaryDirectory() as directory:
            job_dir = Path(directory)
            original = job_dir / "position-0001.png"
            original.write_bytes(b"original")
            for variant in ("contrast", "binary", "dehatch"):
                (job_dir / f"position-0001.{variant}.png").write_bytes(b"variant")

            images = original_diagram_pngs(job_dir)
            self.assertEqual([path.name for path in images], ["position-0001.png"])
            archive = ensure_diagrams_zip(job_dir, images)
            with zipfile.ZipFile(archive) as contents:
                self.assertEqual(contents.namelist(), ["position-0001.png"])
                self.assertEqual(contents.read("position-0001.png"), b"original")

            before = archive.stat().st_mtime_ns
            (job_dir / "position-0001.contrast.png").write_bytes(b"new variant")
            ensure_diagrams_zip(job_dir, original_diagram_pngs(job_dir))
            self.assertEqual(archive.stat().st_mtime_ns, before)
