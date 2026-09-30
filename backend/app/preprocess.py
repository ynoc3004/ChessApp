from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np


VISION_SIZE = 512


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


def _fallback_square_bounds(gray: np.ndarray) -> tuple[int, int, int, int]:
    h, w = gray.shape[:2]
    side = min(h, w)
    x0 = max(0, (w - side) // 2)
    y0 = max(0, (h - side) // 2)
    return x0, y0, min(w, x0 + side), min(h, y0 + side)


def _detect_grid_bounds(gray: np.ndarray) -> tuple[int, int, int, int]:
    """Locate the printed board inside a scanner crop.

    Old chess books often have a strong outer frame. The frame creates a much
    stronger dark-pixel projection than pieces or hatch texture, so searching
    only the outer fifth of each axis is both cheap and stable. If the frame is
    not clear enough we fall back to the largest centered square instead of
    returning a dangerous tiny crop.
    """
    h, w = gray.shape[:2]
    if h < 64 or w < 64:
        return _fallback_square_bounds(gray)

    dark = (gray < 105).astype(np.float32)
    col_projection = dark.mean(axis=0)
    row_projection = dark.mean(axis=1)
    x_band = max(8, w // 5)
    y_band = max(8, h // 5)

    left = int(np.argmax(col_projection[:x_band]))
    right = int(np.argmax(col_projection[w - x_band :]) + (w - x_band))
    top = int(np.argmax(row_projection[:y_band]))
    bottom = int(np.argmax(row_projection[h - y_band :]) + (h - y_band))

    width = right - left
    height = bottom - top
    frame_strength = min(
        float(col_projection[left]),
        float(col_projection[right]),
        float(row_projection[top]),
        float(row_projection[bottom]),
    )
    aspect = width / max(height, 1)

    if (
        frame_strength < 0.35
        or width < w * 0.62
        or height < h * 0.62
        or not 0.78 <= aspect <= 1.28
    ):
        return _fallback_square_bounds(gray)

    # Move just inside the frame so thick black borders are not interpreted as
    # pieces on rank 1/8 or file a/h.
    inset = max(1, int(round(min(h, w) * 0.005)))
    x0 = min(max(0, left + inset), w - 2)
    y0 = min(max(0, top + inset), h - 2)
    x1 = max(x0 + 2, min(w, right - inset + 1))
    y1 = max(y0 + 2, min(h, bottom - inset + 1))
    return x0, y0, x1, y1


def _grid_variant(gray: np.ndarray, size: int = VISION_SIZE) -> np.ndarray:
    x0, y0, x1, y1 = _detect_grid_bounds(gray)
    board = gray[y0:y1, x0:x1]
    if board.size == 0:
        board = gray
    return cv2.resize(board, (size, size), interpolation=cv2.INTER_AREA)


def _square_for_cell(row: int, column: int) -> str:
    return f"{chr(ord('a') + column)}{8 - row}"


def _adaptive_occupancy_threshold(densities: np.ndarray) -> float:
    """Find a conservative split between hatch-only and piece-containing cells."""
    values = densities.astype(np.float32).reshape(-1)
    maximum = float(values.max(initial=0.0))
    if maximum <= 0.001:
        return 0.05

    scaled = np.clip(values / maximum * 255.0, 0, 255).astype(np.uint8)
    otsu, _ = cv2.threshold(
        scaled,
        0,
        255,
        cv2.THRESH_BINARY + cv2.THRESH_OTSU,
    )
    raw = float(otsu) / 255.0 * maximum
    # Otsu separates obvious pieces well, but small printed pawns/rooks can sit
    # just below that split. A 0.65 factor was deliberately chosen to bias the
    # vision prior toward "occupied" only when non-diagonal structure is real.
    return float(np.clip(raw * 0.65, 0.045, 0.07))


def analyze_board_vision(image_path: Path) -> dict:
    """Detect which of the 64 cells visually contain a chess piece.

    The old-book boards used by ChessApp contain diagonal hatch texture on half
    the cells. Raw darkness therefore cannot distinguish a piece from the board
    background. Instead we measure *non-diagonal* strong edges: hatch strokes
    are diagonal, while printed chessmen contribute vertical, horizontal and
    curved contours. This gives an independent occupancy prior that can veto a
    recognizer claiming a visibly occupied square is empty.
    """
    gray = _read_gray(image_path)
    bounds = _detect_grid_bounds(gray)
    board = _grid_variant(gray, VISION_SIZE)
    blurred = cv2.GaussianBlur(board, (3, 3), 0)

    grad_x = cv2.Sobel(blurred, cv2.CV_32F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(blurred, cv2.CV_32F, 0, 1, ksize=3)
    magnitude = cv2.magnitude(grad_x, grad_y)
    angle = (cv2.phase(grad_x, grad_y, angleInDegrees=True) % 180.0).astype(np.float32)
    strong_threshold = max(35.0, float(np.percentile(magnitude, 75)))

    cell_size = VISION_SIZE // 8
    margin = max(5, int(round(cell_size * 0.125)))
    densities = np.zeros((8, 8), dtype=np.float32)

    for row in range(8):
        for column in range(8):
            y0 = row * cell_size + margin
            y1 = (row + 1) * cell_size - margin
            x0 = column * cell_size + margin
            x1 = (column + 1) * cell_size - margin
            local_magnitude = magnitude[y0:y1, x0:x1]
            local_angle = angle[y0:y1, x0:x1]
            strong = local_magnitude > strong_threshold
            diagonal = (
                ((local_angle > 25) & (local_angle < 65))
                | ((local_angle > 115) & (local_angle < 155))
            )
            non_diagonal = strong & ~diagonal
            densities[row, column] = float(non_diagonal.mean())

    occupancy_threshold = _adaptive_occupancy_threshold(densities)
    scale = max(0.012, occupancy_threshold * 0.24)
    occupancy: dict[str, float] = {}
    edge_density: dict[str, float] = {}
    occupied_squares: list[str] = []

    for row in range(8):
        for column in range(8):
            square = _square_for_cell(row, column)
            density = float(densities[row, column])
            probability = 1.0 / (1.0 + math.exp(-(density - occupancy_threshold) / scale))
            occupancy[square] = round(probability, 3)
            edge_density[square] = round(density, 4)
            if density >= occupancy_threshold:
                occupied_squares.append(square)

    return {
        "method": "non-diagonal-gradient-v1",
        "occupancy": occupancy,
        "edgeDensity": edge_density,
        "occupiedSquares": occupied_squares,
        "occupancyThreshold": round(occupancy_threshold, 4),
        "boardBounds": {
            "x0": bounds[0],
            "y0": bounds[1],
            "x1": bounds[2],
            "y1": bounds[3],
        },
    }


def ensure_book_variants(image_path: Path) -> dict[str, Path]:
    """Create recognition-only variants next to a cropped diagram."""
    gray = _read_gray(image_path)
    stem = image_path.stem

    variants = {
        "contrast": image_path.with_name(f"{stem}.contrast.png"),
        "binary": image_path.with_name(f"{stem}.binary.png"),
        "dehatch": image_path.with_name(f"{stem}.dehatch.png"),
        "grid": image_path.with_name(f"{stem}.grid.png"),
        "grid-contrast": image_path.with_name(f"{stem}.grid-contrast.png"),
    }

    grid = _grid_variant(gray)
    generated = {
        "contrast": _contrast_variant(gray),
        "binary": _binary_variant(gray),
        "dehatch": _dehatch_variant(gray),
        "grid": grid,
        "grid-contrast": _contrast_variant(grid),
    }

    source_mtime = image_path.stat().st_mtime
    for name, target in variants.items():
        if target.exists() and target.stat().st_mtime >= source_mtime:
            continue
        _save(target, generated[name])

    return variants
