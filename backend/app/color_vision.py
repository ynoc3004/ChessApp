from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np

from .preprocess import VISION_SIZE, _grid_variant, _read_gray, analyze_board_vision


def _square_for_cell(row: int, column: int) -> str:
    return f"{chr(ord('a') + column)}{8 - row}"


def _cluster_threshold(values: list[float]) -> tuple[float, float]:
    """Split outlined white pieces from solid black pieces by core ink fill."""
    if len(values) < 2:
        return 0.16, 0.0

    low = min(values)
    high = max(values)
    if high - low < 0.018:
        return float(np.clip((low + high) / 2, 0.06, 0.28)), high - low

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
    return float(np.clip((low + high) / 2, 0.06, 0.28)), high - low


def analyze_piece_colors(image_path: Path) -> dict:
    """Estimate white/black piece color independently from piece type.

    Historical chess books normally print black men as a solid black mass and
    white men as a black outline with a light interior. Diagonal hatch lines can
    be dark too, so color is measured from *very dark solid ink in the core* of
    each occupied square instead of from overall darkness. Hatch strokes are
    sparse in the core; a filled black rook/pawn/king is not.
    """
    gray = _read_gray(image_path)
    board = _grid_variant(gray, VISION_SIZE)
    occupancy = analyze_board_vision(image_path)

    # Otsu describes the page's general print split, but its threshold can also
    # include grey hatch texture. Keep only the darker portion so hatch strokes
    # contribute far less than solid black piece bodies.
    otsu_threshold, _ = cv2.threshold(
        board,
        0,
        255,
        cv2.THRESH_BINARY + cv2.THRESH_OTSU,
    )
    solid_cutoff = float(np.clip(float(otsu_threshold) * 0.68, 55.0, 125.0))
    solid_ink = (board < solid_cutoff).astype(np.float32)

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
            local = solid_ink[y0:y1, x0:x1]
            if local.size == 0:
                fill = 0.0
            else:
                h, w = local.shape[:2]
                cy0, cy1 = int(h * 0.2), max(int(h * 0.8), int(h * 0.2) + 1)
                cx0, cx1 = int(w * 0.2), max(int(w * 0.8), int(w * 0.2) + 1)
                core = local[cy0:cy1, cx0:cx1]
                core_ratio = float(core.mean()) if core.size else float(local.mean())
                whole_ratio = float(local.mean())
                # Core density dominates: a white outlined piece has dark
                # contour pixels but a mostly light center, unlike a black one.
                fill = core_ratio * 0.82 + whole_ratio * 0.18

            fill_density[square] = round(fill, 4)
            if float(occupancy["occupancy"].get(square, 0.0)) >= 0.48:
                occupied_fill.append(fill)

    color_threshold, separation = _cluster_threshold(occupied_fill)
    scale = max(0.016, min(0.06, separation / 4 if separation > 0 else 0.045))

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
            confidence *= min(1.0, max(0.0, (occupied_probability - 0.35) / 0.45))
            black_probability[square] = round(probability, 3)
            color_confidence[square] = round(confidence, 3)
            if confidence < 0.42:
                uncertain.append(square)

    return {
        "method": "solid-core-ink-v2",
        "blackProbability": black_probability,
        "colorConfidence": color_confidence,
        "fillDensity": fill_density,
        "colorThreshold": round(color_threshold, 4),
        "clusterSeparation": round(float(separation), 4),
        "solidInkCutoff": round(solid_cutoff, 2),
        "uncertainColorSquares": uncertain,
    }
