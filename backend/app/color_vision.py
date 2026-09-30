from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np

from .preprocess import VISION_SIZE, _dehatch_variant, _grid_variant, _read_gray, analyze_board_vision


def _square_for_cell(row: int, column: int) -> str:
    return f"{chr(ord('a') + column)}{8 - row}"


def _cluster_threshold(values: list[float]) -> tuple[float, float]:
    """Split outlined white pieces from solid black pieces by ink fill.

    Historical diagrams normally contain both sides. A tiny two-cluster fit is
    more robust than a fixed threshold because print darkness varies by book,
    scanner and page. The returned second value is the cluster separation and
    is used to avoid overconfident color flips on ambiguous pages.
    """
    if len(values) < 2:
        return 0.22, 0.0

    low = min(values)
    high = max(values)
    if high - low < 0.025:
        return float(np.clip((low + high) / 2, 0.12, 0.34)), high - low

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
    return float(np.clip((low + high) / 2, 0.12, 0.34)), high - low


def analyze_piece_colors(image_path: Path) -> dict:
    """Estimate white/black piece color independently from piece type.

    Old chess books draw black men as largely solid ink and white men as an
    outline with a light interior. We first remove diagonal hatch texture, then
    measure the amount of solid ink in the center of every visually occupied
    square. This resolver never decides whether a rook is a bishop; it only
    supplies a white-vs-black prior for squares that already contain a piece.
    """
    gray = _read_gray(image_path)
    board = _grid_variant(gray, VISION_SIZE)
    cleaned = _dehatch_variant(board)
    occupancy = analyze_board_vision(image_path)

    _threshold, ink = cv2.threshold(
        cleaned,
        0,
        255,
        cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU,
    )
    ink_float = ink.astype(np.float32) / 255.0

    cell = VISION_SIZE // 8
    margin = max(5, int(round(cell * 0.12)))
    fill_density: dict[str, float] = {}
    occupied_fill: list[float] = []

    for row in range(8):
        for column in range(8):
            square = _square_for_cell(row, column)
            y0 = row * cell + margin
            y1 = (row + 1) * cell - margin
            x0 = column * cell + margin
            x1 = (column + 1) * cell - margin
            local = ink_float[y0:y1, x0:x1]
            if local.size == 0:
                fill = 0.0
            else:
                h, w = local.shape[:2]
                cy0, cy1 = int(h * 0.22), max(int(h * 0.78), int(h * 0.22) + 1)
                cx0, cx1 = int(w * 0.22), max(int(w * 0.78), int(w * 0.22) + 1)
                core = local[cy0:cy1, cx0:cx1]
                core_ratio = float(core.mean()) if core.size else float(local.mean())
                whole_ratio = float(local.mean())
                # Solid black pieces keep a dark core; outlined white pieces
                # have most of their ink around the contour instead.
                fill = core_ratio * 0.72 + whole_ratio * 0.28

            fill_density[square] = round(fill, 4)
            if float(occupancy["occupancy"].get(square, 0.0)) >= 0.48:
                occupied_fill.append(fill)

    color_threshold, separation = _cluster_threshold(occupied_fill)
    # Pages with clearly separated solid/outlined populations get a steeper
    # sigmoid. Ambiguous pages remain near 0.5 and therefore do not force case.
    scale = max(0.022, min(0.07, separation / 4 if separation > 0 else 0.055))

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

            fill = fill_density[square]
            probability = 1.0 / (1.0 + math.exp(-(fill - color_threshold) / scale))
            confidence = abs(probability - 0.5) * 2.0
            # Occupancy uncertainty also limits color certainty.
            confidence *= min(1.0, max(0.0, (occupied_probability - 0.35) / 0.45))
            black_probability[square] = round(probability, 3)
            color_confidence[square] = round(confidence, 3)
            if confidence < 0.42:
                uncertain.append(square)

    return {
        "method": "dehatch-fill-density-v1",
        "blackProbability": black_probability,
        "colorConfidence": color_confidence,
        "fillDensity": fill_density,
        "colorThreshold": round(color_threshold, 4),
        "clusterSeparation": round(float(separation), 4),
        "uncertainColorSquares": uncertain,
    }
