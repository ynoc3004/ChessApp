from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np

from .preprocess import VISION_SIZE, _grid_variant, _read_gray, analyze_board_vision


RECOGNITION_CACHE_VERSION = "recognition-v3.1-color-v1"


def invalidate_legacy_recognition_caches(
    output_dir: Path,
    version: str = RECOGNITION_CACHE_VERSION,
) -> int:
    """Drop only regenerable AI caches once when recognition logic changes.

    User-corrected `.user.json` files are never touched. A small marker avoids
    rescanning/deleting caches on every backend restart. Bump the version string
    when the recognition algorithm changes incompatibly again.
    """
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        marker = output_dir / ".recognition-cache-version"
        if marker.exists() and marker.read_text(encoding="utf-8").strip() == version:
            return 0

        removed = 0
        for cache_path in output_dir.glob("*/position-*.recognition.json"):
            try:
                cache_path.unlink()
                removed += 1
            except OSError:
                continue
        marker.write_text(version, encoding="utf-8")
        return removed
    except OSError:
        # Cache migration must never prevent the backend from starting.
        return 0


def _square_for_cell(row: int, column: int) -> str:
    return f"{chr(ord('a') + column)}{8 - row}"


def _cluster_threshold(values: list[float]) -> tuple[float, float]:
    """Split outlined white pieces from solid black pieces by shape mass."""
    if len(values) < 2:
        return 0.28, 0.0

    low = min(values)
    high = max(values)
    if high - low < 0.025:
        return float(np.clip((low + high) / 2, 0.05, 0.5)), high - low

    for _ in range(10):
        low_group: list[float] = []
        high_group: list[float] = []
        for value in values:
            if abs(value - low) <= abs(value - high):
                low_group.append(value)
            else:
                high_group.append(value)
        if low_group:
            low = sum(low_group) / len(low_group)
        if high_group:
            high = sum(high_group) / len(high_group)

    if low > high:
        low, high = high, low
    return float(np.clip((low + high) / 2, 0.05, 0.5)), high - low


def _shape_mass(local: np.ndarray) -> tuple[float, float, float, float]:
    """Return (score, largest-component, hole-area, ink-ratio)."""
    if local.size == 0:
        return 0.0, 0.0, 0.0, 0.0

    binary = (local > 0).astype(np.uint8)
    ink_ratio = float(binary.mean())
    count, _labels, stats, _centroids = cv2.connectedComponentsWithStats(binary, 8)
    largest = 0.0
    if count > 1:
        largest = float(stats[1:, cv2.CC_STAT_AREA].max()) / float(binary.size)

    contours, hierarchy = cv2.findContours(
        (binary * 255).astype(np.uint8),
        cv2.RETR_CCOMP,
        cv2.CHAIN_APPROX_SIMPLE,
    )
    hole_area = 0.0
    if hierarchy is not None:
        for index, contour in enumerate(contours):
            if hierarchy[0][index][3] == -1:
                continue
            area = float(cv2.contourArea(contour))
            if area >= 2.0:
                hole_area += area / float(binary.size)

    # Black pieces are one large solid component. White pieces often have a
    # large bright cavity enclosed by their outline (king/bishop/rook especially).
    score = largest - hole_area * 1.05 + ink_ratio * 0.12
    return score, largest, hole_area, ink_ratio


def analyze_piece_colors(image_path: Path) -> dict:
    """Estimate white/black piece color independently from piece type.

    Historical chess books normally print black men as solid silhouettes and
    white men as outlines with bright internal cavities. The resolver measures
    connected solid mass and enclosed white-hole area, then subtracts the empty
    background baseline of the same board parity so diagonal hatch texture does
    not become a false color signal.
    """
    gray = _read_gray(image_path)
    board = _grid_variant(gray, VISION_SIZE)
    occupancy = analyze_board_vision(image_path)

    otsu_threshold, _ = cv2.threshold(
        board,
        0,
        255,
        cv2.THRESH_BINARY + cv2.THRESH_OTSU,
    )
    solid_cutoff = float(np.clip(float(otsu_threshold) * 0.68, 55.0, 125.0))
    solid_ink = (board < solid_cutoff).astype(np.uint8)

    cell = VISION_SIZE // 8
    margin = max(5, int(round(cell * 0.12)))
    raw_score: dict[str, float] = {}
    largest_component: dict[str, float] = {}
    hole_area: dict[str, float] = {}
    ink_ratio: dict[str, float] = {}
    parity_by_square: dict[str, int] = {}

    for row in range(8):
        for column in range(8):
            square = _square_for_cell(row, column)
            parity_by_square[square] = (row + column) % 2
            y0 = row * cell + margin
            y1 = (row + 1) * cell - margin
            x0 = column * cell + margin
            x1 = (column + 1) * cell - margin
            score, largest, holes, ratio = _shape_mass(solid_ink[y0:y1, x0:x1])
            raw_score[square] = score
            largest_component[square] = round(largest, 4)
            hole_area[square] = round(holes, 4)
            ink_ratio[square] = round(ratio, 4)

    background_samples: dict[int, list[float]] = {0: [], 1: []}
    for square, score in raw_score.items():
        occupied_probability = float(occupancy["occupancy"].get(square, 0.0))
        if occupied_probability <= 0.32:
            background_samples[parity_by_square[square]].append(score)

    background_baseline: dict[int, float] = {}
    for parity in (0, 1):
        samples = background_samples[parity]
        if samples:
            background_baseline[parity] = float(np.median(samples))
        else:
            parity_values = [
                score for square, score in raw_score.items()
                if parity_by_square[square] == parity
            ]
            background_baseline[parity] = float(np.percentile(parity_values, 25)) if parity_values else 0.0

    shape_mass: dict[str, float] = {}
    occupied_mass: list[float] = []
    for square, score in raw_score.items():
        adjusted = max(0.0, score - background_baseline[parity_by_square[square]])
        shape_mass[square] = round(adjusted, 4)
        if float(occupancy["occupancy"].get(square, 0.0)) >= 0.48:
            occupied_mass.append(adjusted)

    color_threshold, separation = _cluster_threshold(occupied_mass)
    scale = max(0.02, min(0.09, separation / 4 if separation > 0 else 0.06))

    black_probability: dict[str, float] = {}
    color_confidence: dict[str, float] = {}
    uncertain: list[str] = []

    for row in range(8):
        for column in range(8):
            square = _square_for_cell(row, column)
            occupied_probability = float(occupancy["occupancy"].get(square, 0.0))
            if occupied_probability < 0.42:
                black_probability[square] = 0.5
                color_confidence[square] = 0.0
                continue

            mass = shape_mass[square]
            probability = 1.0 / (1.0 + math.exp(-(mass - color_threshold) / scale))
            confidence = abs(probability - 0.5) * 2.0
            confidence *= min(1.0, max(0.0, (occupied_probability - 0.35) / 0.45))
            black_probability[square] = round(probability, 3)
            color_confidence[square] = round(confidence, 3)
            if confidence < 0.42:
                uncertain.append(square)

    return {
        "method": "connected-mass-holes-v4",
        "blackProbability": black_probability,
        "colorConfidence": color_confidence,
        "shapeMass": shape_mass,
        "largestComponent": largest_component,
        "holeArea": hole_area,
        "inkRatio": ink_ratio,
        "backgroundBaseline": {
            "lightParity": round(background_baseline[0], 4),
            "darkParity": round(background_baseline[1], 4),
        },
        "colorThreshold": round(color_threshold, 4),
        "clusterSeparation": round(float(separation), 4),
        "solidInkCutoff": round(solid_cutoff, 2),
        "uncertainColorSquares": uncertain,
    }


# Imported by `recognizer.py` during backend startup. This intentionally clears
# only derivative AI caches once for this recognition-version upgrade so old
# color-wrong results cannot silently bypass the new resolver.
_DATA_POSITIONS = Path(__file__).resolve().parent.parent / "data" / "positions"
invalidate_legacy_recognition_caches(_DATA_POSITIONS)
