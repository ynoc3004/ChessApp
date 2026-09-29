"""Helpers for the files produced by a book scan."""

import re
import zipfile
from pathlib import Path


ORIGINAL_DIAGRAM = re.compile(r"^position-\d{4}\.png$")


def original_diagram_pngs(job_dir: Path) -> list[Path]:
    return sorted(
        path for path in job_dir.glob("position-*.png")
        if ORIGINAL_DIAGRAM.fullmatch(path.name)
    )


def ensure_diagrams_zip(job_dir: Path, png_files: list[Path]) -> Path:
    zip_path = job_dir / "chess-diagrams.zip"
    newest_png = max(path.stat().st_mtime for path in png_files)
    if not zip_path.exists() or zip_path.stat().st_mtime < newest_png:
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for image_path in png_files:
                archive.write(image_path, arcname=image_path.name)
    return zip_path
