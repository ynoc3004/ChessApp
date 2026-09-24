from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
import zipfile

import cv2
import fitz
import numpy as np


@dataclass
class DetectedBoard:
    page: int
    image: np.ndarray
    score: float


def _dedupe_boxes(boxes: list[tuple[int, int, int, int, float]], iou_threshold: float = 0.55):
    boxes = sorted(boxes, key=lambda b: b[4], reverse=True)
    kept: list[tuple[int, int, int, int, float]] = []

    def iou(a, b):
        ax, ay, aw, ah, _ = a
        bx, by, bw, bh, _ = b
        x1, y1 = max(ax, bx), max(ay, by)
        x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
        inter = max(0, x2 - x1) * max(0, y2 - y1)
        union = aw * ah + bw * bh - inter
        return inter / union if union else 0

    for box in boxes:
        if all(iou(box, other) < iou_threshold for other in kept):
            kept.append(box)
    return kept


def _grid_score(gray: np.ndarray) -> float:
    h, w = gray.shape[:2]
    if min(h, w) < 120:
        return 0.0

    size = min(h, w)
    gray = cv2.resize(gray, (size, size), interpolation=cv2.INTER_AREA)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blur, 60, 170)

    # Strong vertical/horizontal energy near the 9 expected grid boundaries.
    proj_x = edges.mean(axis=0) / 255.0
    proj_y = edges.mean(axis=1) / 255.0
    radius = max(2, size // 80)
    positions = np.linspace(0, size - 1, 9)

    x_hits = 0
    y_hits = 0
    for p in positions:
        p = int(round(p))
        lo, hi = max(0, p - radius), min(size, p + radius + 1)
        if proj_x[lo:hi].max(initial=0) > 0.12:
            x_hits += 1
        if proj_y[lo:hi].max(initial=0) > 0.12:
            y_hits += 1

    # Chess diagrams normally have alternating light/dark square backgrounds.
    cell_means = []
    margin = 0.20
    cell = size / 8.0
    for r in range(8):
        row = []
        for c in range(8):
            x1 = int((c + margin) * cell)
            x2 = int((c + 1 - margin) * cell)
            y1 = int((r + margin) * cell)
            y2 = int((r + 1 - margin) * cell)
            patch = gray[y1:y2, x1:x2]
            row.append(float(patch.mean()) if patch.size else 0.0)
        cell_means.append(row)

    cells = np.asarray(cell_means, dtype=np.float32)
    pattern = np.fromfunction(lambda r, c: ((r + c) % 2) * 2 - 1, (8, 8), dtype=int).astype(np.float32)
    centered = cells - cells.mean()
    denom = float(centered.std()) + 1e-6
    checker = abs(float((centered * pattern).mean()) / denom)

    line_score = (x_hits + y_hits) / 18.0
    checker_score = min(checker / 0.65, 1.0)
    return 0.72 * line_score + 0.28 * checker_score


def detect_boards_in_image(image_bgr: np.ndarray) -> list[tuple[np.ndarray, float]]:
    if image_bgr is None or image_bgr.size == 0:
        return []

    original = image_bgr
    gray = cv2.cvtColor(original, cv2.COLOR_BGR2GRAY)

    # Downscale only for finding candidate rectangles; crop from original later.
    max_dim = max(gray.shape[:2])
    scale = min(1.0, 2200.0 / max_dim)
    if scale < 1.0:
        small = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    else:
        small = gray

    binary = cv2.adaptiveThreshold(
        small,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        31,
        7,
    )
    contours, _ = cv2.findContours(binary, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    sh, sw = small.shape[:2]
    page_area = sh * sw
    candidates: list[tuple[int, int, int, int, float]] = []

    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        if area < page_area * 0.018 or area > page_area * 0.70:
            continue
        if min(w, h) < 120:
            continue
        aspect = w / float(h)
        if not 0.78 <= aspect <= 1.22:
            continue

        crop = small[y:y+h, x:x+w]
        score = _grid_score(crop)
        if score >= 0.66:
            candidates.append((x, y, w, h, score))

    candidates = _dedupe_boxes(candidates)
    results: list[tuple[np.ndarray, float]] = []
    inv = 1.0 / scale
    oh, ow = original.shape[:2]

    for x, y, w, h, score in candidates:
        x1 = max(0, int((x - w * 0.02) * inv))
        y1 = max(0, int((y - h * 0.02) * inv))
        x2 = min(ow, int((x + w * 1.02) * inv))
        y2 = min(oh, int((y + h * 1.02) * inv))
        results.append((original[y1:y2, x1:x2].copy(), score))

    return results


def extract_from_pdf(path: Path) -> Iterable[DetectedBoard]:
    doc = fitz.open(path)
    for page_index in range(len(doc)):
        page = doc[page_index]
        matrix = fitz.Matrix(2.2, 2.2)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        if pix.n == 4:
            bgr = cv2.cvtColor(arr, cv2.COLOR_RGBA2BGR)
        else:
            bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
        for crop, score in detect_boards_in_image(bgr):
            yield DetectedBoard(page=page_index + 1, image=crop, score=score)


def extract_docx_images(path: Path) -> Iterable[tuple[str, np.ndarray]]:
    with zipfile.ZipFile(path) as zf:
        names = [n for n in zf.namelist() if n.startswith("word/media/")]
        for name in names:
            data = np.frombuffer(zf.read(name), dtype=np.uint8)
            image = cv2.imdecode(data, cv2.IMREAD_COLOR)
            if image is not None:
                yield name, image


def extract_from_docx(path: Path) -> Iterable[DetectedBoard]:
    for index, (_name, image) in enumerate(extract_docx_images(path), start=1):
        # Many chess diagrams in DOCX are already embedded as individual images.
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        direct_score = _grid_score(gray) if 0.70 <= image.shape[1] / max(image.shape[0], 1) <= 1.35 else 0
        if direct_score >= 0.58:
            yield DetectedBoard(page=index, image=image, score=direct_score)
            continue

        for crop, score in detect_boards_in_image(image):
            yield DetectedBoard(page=index, image=crop, score=score)
