from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np


def _read_gray(image_path: Path) -> np.ndarray:
    image = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError(f"Could not read image: {image_path}")
    return image


def _save(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(path), image):
        raise ValueError(f"Could not write image: {path}")


def _contrast_variant(gray: np.ndarray) -> np.ndarray:
    """Local contrast + mild sharpening for faded scans."""
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    blur = cv2.GaussianBlur(enhanced, (0, 0), 1.1)
    sharp = cv2.addWeighted(enhanced, 1.65, blur, -0.65, 0)
    return sharp


def _binary_variant(gray: np.ndarray) -> np.ndarray:
    """Adaptive monochrome version for low-contrast printed diagrams."""
    denoised = cv2.GaussianBlur(gray, (3, 3), 0)
    block = max(15, (min(gray.shape[:2]) // 16) | 1)
    block = min(block, 51)
    if block % 2 == 0:
        block += 1
    binary = cv2.adaptiveThreshold(
        denoised,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        block,
        7,
    )
    return cv2.medianBlur(binary, 3)


def _diagonal_kernel(size: int, reverse: bool = False) -> np.ndarray:
    kernel = np.zeros((size, size), dtype=np.uint8)
    for i in range(size):
        j = size - 1 - i if reverse else i
        kernel[i, j] = 1
    return kernel


def _dehatch_variant(gray: np.ndarray) -> np.ndarray:
    """Reduce long diagonal hatch strokes common in older chess books.

    Long diagonal lines are removed conservatively while shorter piece
    contours are retained. This is an auxiliary recognition candidate,
    never a destructive replacement for the original image.
    """
    contrast = _contrast_variant(gray)
    _, ink = cv2.threshold(
        contrast,
        0,
        255,
        cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU,
    )

    size = max(7, min(17, (min(gray.shape[:2]) // 34) | 1))
    diag_a = cv2.morphologyEx(
        ink,
        cv2.MORPH_OPEN,
        _diagonal_kernel(size, reverse=False),
    )
    diag_b = cv2.morphologyEx(
        ink,
        cv2.MORPH_OPEN,
        _diagonal_kernel(size, reverse=True),
    )
    hatch = cv2.max(diag_a, diag_b)

    # Do not erase everything detected as a diagonal line. Dilating the
    # residual slightly reconnects thin printed piece outlines.
    residual = cv2.subtract(ink, hatch)
    residual = cv2.morphologyEx(
        residual,
        cv2.MORPH_CLOSE,
        np.ones((2, 2), dtype=np.uint8),
        iterations=1,
    )
    return cv2.bitwise_not(residual)


def ensure_book_variants(image_path: Path) -> dict[str, Path]:
    """Create recognition-only variants next to a cropped diagram."""
    gray = _read_gray(image_path)
    stem = image_path.stem

    variants = {
        "contrast": image_path.with_name(f"{stem}.contrast.png"),
        "binary": image_path.with_name(f"{stem}.binary.png"),
        "dehatch": image_path.with_name(f"{stem}.dehatch.png"),
    }

    generators = {
        "contrast": _contrast_variant,
        "binary": _binary_variant,
        "dehatch": _dehatch_variant,
    }

    source_mtime = image_path.stat().st_mtime
    for name, target in variants.items():
        if target.exists() and target.stat().st_mtime >= source_mtime:
            continue
        _save(target, generators[name](gray))

    return variants
