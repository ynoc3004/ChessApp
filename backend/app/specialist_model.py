from __future__ import annotations

import hashlib
import json
import math
import os
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable

import cv2
import numpy as np

from .preprocess import VISION_SIZE, _grid_variant, _read_gray

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
LEARNING_DIR = DATA_DIR / "learning_corrections"
MODEL_DIR = DATA_DIR / "models"
MODEL_PATH = MODEL_DIR / "piece-specialist-v1.npz"
MODEL_META_PATH = MODEL_DIR / "piece-specialist-v1.json"
MODEL_VERSION = 1
CLASSES = (".", "P", "N", "B", "R", "Q", "K", "p", "n", "b", "r", "q", "k")
CLASS_INDEX = {label: index for index, label in enumerate(CLASSES)}
MIN_CLASS_EXAMPLES = 3
MAX_PROTOTYPES_PER_CLASS = 192
TYPE_CONFIDENCE_THRESHOLD = 0.58
TYPE_MARGIN_THRESHOLD = 0.08

_MODEL_CACHE: dict[str, object] = {"mtime": None, "data": None}


def _expand_placement(fen: str) -> list[str] | None:
    placement = str(fen or "").strip().split()[0]
    ranks = placement.split("/")
    if len(ranks) != 8:
        return None
    cells: list[str] = []
    for rank in ranks:
        row: list[str] = []
        for token in rank:
            if token.isdigit():
                width = int(token)
                if not 1 <= width <= 8:
                    return None
                row.extend(["."] * width)
            elif token in CLASS_INDEX and token != ".":
                row.append(token)
            else:
                return None
        if len(row) != 8:
            return None
        cells.extend(row)
    return cells if len(cells) == 64 else None


def _compress_placement(cells: list[str]) -> str:
    ranks: list[str] = []
    for start in range(0, 64, 8):
        rank = ""
        empty = 0
        for piece in cells[start : start + 8]:
            if piece == ".":
                empty += 1
            else:
                if empty:
                    rank += str(empty)
                    empty = 0
                rank += piece
        if empty:
            rank += str(empty)
        ranks.append(rank)
    return "/".join(ranks)


def _square_for_index(index: int) -> str:
    row, column = divmod(index, 8)
    return f"{chr(ord('a') + column)}{8 - row}"


def _training_labels(fen: str, orientation: str) -> list[str] | None:
    cells = _expand_placement(fen)
    if cells is None:
        return None
    if orientation == "black":
        return list(reversed(cells))
    if orientation == "white":
        return cells
    return None


def _tile_feature(tile: np.ndarray) -> np.ndarray:
    """Compact shape feature for old printed chess pieces.

    The feature mixes low-resolution ink, gradients and very-dark mass. It is
    deliberately classical: training stays instant on a local laptop and does
    not introduce a second ML framework beside the existing recognizer.
    """
    if tile.ndim == 3:
        tile = cv2.cvtColor(tile, cv2.COLOR_BGR2GRAY)
    tile = cv2.resize(tile, (32, 32), interpolation=cv2.INTER_AREA)
    tile = cv2.equalizeHist(tile.astype(np.uint8))

    ink = 1.0 - tile.astype(np.float32) / 255.0
    low_ink = cv2.resize(ink, (12, 12), interpolation=cv2.INTER_AREA).reshape(-1)

    gx = cv2.Sobel(tile, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(tile, cv2.CV_32F, 0, 1, ksize=3)
    magnitude = cv2.magnitude(gx, gy)
    if float(magnitude.max(initial=0.0)) > 0:
        magnitude /= float(magnitude.max())
    low_grad = cv2.resize(magnitude, (8, 8), interpolation=cv2.INTER_AREA).reshape(-1)

    dark = (tile < 95).astype(np.float32)
    low_dark = cv2.resize(dark, (8, 8), interpolation=cv2.INTER_AREA).reshape(-1)

    row_projection = cv2.resize(ink.mean(axis=1).reshape(-1, 1), (1, 8), interpolation=cv2.INTER_AREA).reshape(-1)
    col_projection = cv2.resize(ink.mean(axis=0).reshape(1, -1), (8, 1), interpolation=cv2.INTER_AREA).reshape(-1)

    feature = np.concatenate([low_ink, low_grad, low_dark, row_projection, col_projection]).astype(np.float32)
    norm = float(np.linalg.norm(feature))
    if norm > 1e-8:
        feature /= norm
    return feature


def _board_features(image_path: Path) -> np.ndarray:
    gray = _read_gray(image_path)
    board = _grid_variant(gray, VISION_SIZE)
    cell = VISION_SIZE // 8
    margin = max(3, int(round(cell * 0.07)))
    rows: list[np.ndarray] = []
    for row in range(8):
        for column in range(8):
            y0 = row * cell + margin
            y1 = (row + 1) * cell - margin
            x0 = column * cell + margin
            x1 = (column + 1) * cell - margin
            rows.append(_tile_feature(board[y0:y1, x0:x1]))
    return np.stack(rows).astype(np.float32)


def _load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _image_path(learning_dir: Path, metadata: dict, sample_id: str) -> Path:
    name = Path(str(metadata.get("image") or f"{sample_id}.png")).name
    return learning_dir / name


def dataset_fingerprint(learning_dir: Path = LEARNING_DIR) -> str:
    digest = hashlib.sha256()
    if not learning_dir.exists():
        return digest.hexdigest()
    for path in sorted(learning_dir.glob("*.json")):
        try:
            stat = path.stat()
            digest.update(path.name.encode("utf-8"))
            digest.update(str(stat.st_size).encode("ascii"))
            digest.update(str(stat.st_mtime_ns).encode("ascii"))
            metadata = _load_json(path)
            digest.update(str(metadata.get("correctedFen") or "").encode("utf-8"))
            digest.update(str(metadata.get("imageOrientation") or "").encode("utf-8"))
        except OSError:
            continue
    return digest.hexdigest()


def collect_training_examples(learning_dir: Path = LEARNING_DIR) -> dict:
    features: list[np.ndarray] = []
    labels: list[str] = []
    groups: list[str] = []
    boards = 0
    skipped_image = 0
    skipped_fen = 0
    skipped_orientation = 0
    class_counts: Counter[str] = Counter()

    if not learning_dir.exists():
        return {
            "features": np.empty((0, 0), dtype=np.float32),
            "labels": np.empty((0,), dtype=np.int16),
            "groups": [],
            "classCounts": {},
            "boards": 0,
            "skippedImage": 0,
            "skippedFen": 0,
            "skippedOrientation": 0,
        }

    for meta_path in sorted(learning_dir.glob("*.json")):
        metadata = _load_json(meta_path)
        sample_id = str(metadata.get("sampleId") or meta_path.stem)
        orientation = str(metadata.get("imageOrientation") or "").lower()
        if orientation not in {"white", "black"}:
            skipped_orientation += 1
            continue
        board_labels = _training_labels(str(metadata.get("correctedFen") or ""), orientation)
        if board_labels is None:
            skipped_fen += 1
            continue
        image_path = _image_path(learning_dir, metadata, sample_id)
        if not image_path.exists():
            skipped_image += 1
            continue
        try:
            board_features = _board_features(image_path)
        except Exception:
            skipped_image += 1
            continue
        if board_features.shape[0] != 64:
            skipped_image += 1
            continue

        boards += 1
        for index, label in enumerate(board_labels):
            features.append(board_features[index])
            labels.append(label)
            groups.append(sample_id)
            class_counts[label] += 1

    feature_matrix = np.stack(features).astype(np.float32) if features else np.empty((0, 0), dtype=np.float32)
    label_indices = np.array([CLASS_INDEX[label] for label in labels], dtype=np.int16)
    return {
        "features": feature_matrix,
        "labels": label_indices,
        "groups": groups,
        "classCounts": dict(class_counts),
        "boards": boards,
        "skippedImage": skipped_image,
        "skippedFen": skipped_fen,
        "skippedOrientation": skipped_orientation,
    }


def _prototype_indices(labels: np.ndarray, groups: list[str], validation_groups: set[str]) -> np.ndarray:
    selected: list[int] = []
    for class_index, _label in enumerate(CLASSES):
        indices = [
            index for index, value in enumerate(labels.tolist())
            if int(value) == class_index and groups[index] not in validation_groups
        ]
        if not indices:
            continue
        cap = MAX_PROTOTYPES_PER_CLASS
        if len(indices) <= cap:
            selected.extend(indices)
        else:
            positions = np.linspace(0, len(indices) - 1, cap, dtype=int)
            selected.extend(indices[int(position)] for position in positions)
    return np.array(selected, dtype=np.int64)


def _class_scores(feature: np.ndarray, prototypes: np.ndarray, prototype_labels: np.ndarray) -> np.ndarray:
    scores = np.full(len(CLASSES), -1.0, dtype=np.float32)
    if prototypes.size == 0:
        return scores
    similarities = prototypes @ feature
    for class_index in range(len(CLASSES)):
        values = similarities[prototype_labels == class_index]
        if values.size:
            top = np.sort(values)[-min(5, values.size):]
            # The best template carries most of the signal while several nearby
            # templates reduce sensitivity to one noisy scan.
            scores[class_index] = float(top.max() * 0.72 + top.mean() * 0.28)
    return scores


def _softmax_scores(scores: np.ndarray) -> np.ndarray:
    valid = scores > -0.5
    probabilities = np.zeros_like(scores, dtype=np.float32)
    if not valid.any():
        return probabilities
    scaled = (scores[valid] - float(scores[valid].max())) / 0.075
    exp = np.exp(np.clip(scaled, -30, 30))
    probabilities[valid] = exp / max(float(exp.sum()), 1e-8)
    return probabilities


def _validation_metrics(
    features: np.ndarray,
    labels: np.ndarray,
    groups: list[str],
    validation_groups: set[str],
    prototypes: np.ndarray,
    prototype_labels: np.ndarray,
) -> dict:
    indices = [index for index, group in enumerate(groups) if group in validation_groups]
    if not indices or prototypes.size == 0:
        return {"tiles": 0, "accuracy": None, "pieceTiles": 0, "pieceAccuracy": None}
    correct = 0
    piece_total = 0
    piece_correct = 0
    for index in indices:
        probabilities = _softmax_scores(_class_scores(features[index], prototypes, prototype_labels))
        predicted = int(np.argmax(probabilities))
        actual = int(labels[index])
        correct += int(predicted == actual)
        if actual != 0:
            piece_total += 1
            piece_correct += int(predicted == actual)
    return {
        "tiles": len(indices),
        "accuracy": round(correct / len(indices), 4),
        "pieceTiles": piece_total,
        "pieceAccuracy": round(piece_correct / piece_total, 4) if piece_total else None,
    }


def train_specialist_model(
    learning_dir: Path = LEARNING_DIR,
    model_path: Path = MODEL_PATH,
    meta_path: Path = MODEL_META_PATH,
) -> dict:
    data = collect_training_examples(learning_dir)
    features = data["features"]
    labels = data["labels"]
    groups: list[str] = data["groups"]
    if features.shape[0] == 0:
        raise ValueError("Chưa có sample hợp lệ để huấn luyện model chuyên biệt.")

    unique_groups = sorted(set(groups))
    validation_groups: set[str] = set()
    if len(unique_groups) >= 5:
        validation_groups = {
            group for index, group in enumerate(unique_groups)
            if index % 5 == 0
        }
        if len(validation_groups) == len(unique_groups):
            validation_groups = set()

    selected = _prototype_indices(labels, groups, validation_groups)
    if selected.size == 0:
        selected = np.arange(features.shape[0], dtype=np.int64)
    prototypes = features[selected]
    prototype_labels = labels[selected]

    validation = _validation_metrics(
        features, labels, groups, validation_groups, prototypes, prototype_labels
    )
    prototype_counts = Counter(CLASSES[int(index)] for index in prototype_labels.tolist())
    class_counts = {label: int(data["classCounts"].get(label, 0)) for label in CLASSES}
    usable_piece_classes = sum(
        1 for label in CLASSES[1:] if class_counts[label] >= MIN_CLASS_EXAMPLES
    )
    metadata = {
        "version": MODEL_VERSION,
        "trainedAt": time.time(),
        "datasetFingerprint": dataset_fingerprint(learning_dir),
        "boards": int(data["boards"]),
        "tiles": int(features.shape[0]),
        "pieceTiles": int(sum(count for label, count in class_counts.items() if label != ".")),
        "classCounts": class_counts,
        "prototypeCounts": {label: int(prototype_counts.get(label, 0)) for label in CLASSES},
        "usablePieceClasses": usable_piece_classes,
        "skippedImage": int(data["skippedImage"]),
        "skippedFen": int(data["skippedFen"]),
        "skippedOrientation": int(data["skippedOrientation"]),
        "validation": validation,
        "featureSize": int(features.shape[1]),
    }

    model_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_model = model_path.with_suffix(".tmp")
    with tmp_model.open("wb") as handle:
        np.savez_compressed(
            handle,
            prototypes=prototypes.astype(np.float32),
            prototype_labels=prototype_labels.astype(np.int16),
            class_counts=np.array([class_counts[label] for label in CLASSES], dtype=np.int32),
            classes=np.array(CLASSES),
            version=np.array([MODEL_VERSION], dtype=np.int16),
        )
    os.replace(tmp_model, model_path)
    tmp_meta = meta_path.with_suffix(".tmp")
    tmp_meta.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp_meta, meta_path)
    _MODEL_CACHE.update(mtime=None, data=None)
    return metadata


def _load_model(model_path: Path = MODEL_PATH) -> dict | None:
    if not model_path.exists():
        return None
    try:
        mtime = model_path.stat().st_mtime_ns
        if _MODEL_CACHE.get("mtime") == mtime and _MODEL_CACHE.get("data") is not None:
            return _MODEL_CACHE["data"]  # type: ignore[return-value]
        with np.load(model_path, allow_pickle=False) as archive:
            data = {
                "prototypes": archive["prototypes"].astype(np.float32),
                "prototypeLabels": archive["prototype_labels"].astype(np.int16),
                "classCounts": archive["class_counts"].astype(np.int32),
                "classes": tuple(str(value) for value in archive["classes"].tolist()),
                "version": int(archive["version"][0]),
            }
        if data["classes"] != CLASSES or data["version"] != MODEL_VERSION:
            return None
        _MODEL_CACHE.update(mtime=mtime, data=data)
        return data
    except (OSError, KeyError, ValueError):
        return None


def specialist_status(
    learning_dir: Path = LEARNING_DIR,
    model_path: Path = MODEL_PATH,
    meta_path: Path = MODEL_META_PATH,
) -> dict:
    metadata = _load_json(meta_path) if meta_path.exists() else {}
    current_fingerprint = dataset_fingerprint(learning_dir)
    model_exists = model_path.exists() and _load_model(model_path) is not None
    return {
        "modelExists": model_exists,
        "modelBytes": model_path.stat().st_size if model_path.exists() else 0,
        "trainedAt": metadata.get("trainedAt"),
        "trainedBoards": int(metadata.get("boards", 0) or 0),
        "trainedTiles": int(metadata.get("tiles", 0) or 0),
        "pieceTiles": int(metadata.get("pieceTiles", 0) or 0),
        "classCounts": metadata.get("classCounts", {}),
        "prototypeCounts": metadata.get("prototypeCounts", {}),
        "usablePieceClasses": int(metadata.get("usablePieceClasses", 0) or 0),
        "validation": metadata.get("validation", {}),
        "skippedImage": int(metadata.get("skippedImage", 0) or 0),
        "skippedFen": int(metadata.get("skippedFen", 0) or 0),
        "skippedOrientation": int(metadata.get("skippedOrientation", 0) or 0),
        "datasetFingerprint": current_fingerprint,
        "trainedFingerprint": metadata.get("datasetFingerprint"),
        "stale": bool(model_exists and metadata.get("datasetFingerprint") != current_fingerprint),
        "ready": bool(model_exists and int(metadata.get("usablePieceClasses", 0) or 0) > 0),
        "version": MODEL_VERSION,
    }


def predict_board(image_path: Path, orientation: str, model_path: Path = MODEL_PATH) -> dict | None:
    model = _load_model(model_path)
    if model is None or orientation not in {"white", "black"}:
        return None
    image_features = _board_features(image_path)
    if orientation == "black":
        image_features = image_features[::-1].copy()

    predictions: dict[str, dict] = {}
    class_counts: np.ndarray = model["classCounts"]  # type: ignore[assignment]
    for index, feature in enumerate(image_features):
        scores = _class_scores(
            feature,
            model["prototypes"],  # type: ignore[arg-type]
            model["prototypeLabels"],  # type: ignore[arg-type]
        )
        probabilities = _softmax_scores(scores)
        # Classes without enough user examples are not allowed to override the
        # mature base recognizer, though they remain visible in diagnostics.
        trusted = probabilities.copy()
        for class_index, count in enumerate(class_counts.tolist()):
            if class_index != 0 and int(count) < MIN_CLASS_EXAMPLES:
                trusted[class_index] = 0.0
        if float(trusted.sum()) > 0:
            trusted /= float(trusted.sum())
        else:
            trusted = probabilities

        # Aggregate white+black versions of the same piece into a type score;
        # v3.1 Color Resolver remains authoritative for side/color.
        type_scores = {
            ".": float(trusted[CLASS_INDEX["."]]),
            "P": float(trusted[CLASS_INDEX["P"]] + trusted[CLASS_INDEX["p"]]),
            "N": float(trusted[CLASS_INDEX["N"]] + trusted[CLASS_INDEX["n"]]),
            "B": float(trusted[CLASS_INDEX["B"]] + trusted[CLASS_INDEX["b"]]),
            "R": float(trusted[CLASS_INDEX["R"]] + trusted[CLASS_INDEX["r"]]),
            "Q": float(trusted[CLASS_INDEX["Q"]] + trusted[CLASS_INDEX["q"]]),
            "K": float(trusted[CLASS_INDEX["K"]] + trusted[CLASS_INDEX["k"]]),
        }
        ordered_types = sorted(type_scores.items(), key=lambda item: item[1], reverse=True)
        best_type, best_type_confidence = ordered_types[0]
        second = ordered_types[1][1] if len(ordered_types) > 1 else 0.0
        best_class = int(np.argmax(trusted))
        square = _square_for_index(index)
        predictions[square] = {
            "label": CLASSES[best_class],
            "classConfidence": round(float(trusted[best_class]), 4),
            "type": best_type,
            "typeConfidence": round(best_type_confidence, 4),
            "typeMargin": round(best_type_confidence - second, 4),
        }
    return predictions


def apply_specialist_types(result: dict, predictions: dict[str, dict] | None) -> dict:
    output = dict(result)
    output["specialistModelVersion"] = MODEL_VERSION
    if not predictions:
        output["specialistAvailable"] = False
        output["specialistCorrectedSquares"] = []
        return output

    cells = _expand_placement(str(result.get("piecePlacement") or ""))
    if cells is None:
        output["specialistAvailable"] = True
        output["specialistCorrectedSquares"] = []
        return output

    corrected = list(cells)
    changed: list[str] = []
    uncertain: list[str] = []
    agreements: list[float] = []
    for index, base_piece in enumerate(cells):
        if base_piece == ".":
            continue
        square = _square_for_index(index)
        prediction = predictions.get(square) or {}
        predicted_type = str(prediction.get("type") or ".")
        confidence = float(prediction.get("typeConfidence") or 0.0)
        margin = float(prediction.get("typeMargin") or 0.0)
        base_type = base_piece.upper()
        if predicted_type != ".":
            agreements.append(confidence if predicted_type == base_type else 1.0 - confidence)
        if confidence < TYPE_CONFIDENCE_THRESHOLD or margin < TYPE_MARGIN_THRESHOLD:
            uncertain.append(square)
            continue
        if predicted_type in {"P", "N", "B", "R", "Q", "K"} and predicted_type != base_type:
            corrected[index] = predicted_type.lower() if base_piece.islower() else predicted_type
            changed.append(square)

    candidate = _compress_placement(corrected)
    # Import lazily to avoid a module cycle: recognizer owns chess-structure
    # scoring, while this module owns the local learned model.
    from .recognizer import placement_quality  # pylint: disable=import-outside-toplevel

    before_quality = placement_quality(str(result["piecePlacement"]))
    after_quality = placement_quality(candidate)
    accept = bool(changed) and (
        float(after_quality["score"]) >= float(before_quality["score"]) - 0.9
        or (bool(after_quality["valid"]) and not bool(before_quality["valid"]))
    )
    final = candidate if accept else str(result["piecePlacement"])
    final_changed = changed if accept else []
    final_quality = after_quality if accept else before_quality

    output["specialistAvailable"] = True
    output["specialistCorrectedSquares"] = final_changed
    output["specialistUncertainSquares"] = uncertain
    output["specialistTypeAgreement"] = round(sum(agreements) / len(agreements), 4) if agreements else 0.0
    output["specialistPredictions"] = predictions
    output["piecePlacement"] = final
    output["validPlacement"] = final_quality["valid"]
    output["placementQuality"] = final_quality["score"]
    output["qualityReasons"] = final_quality["reasons"]

    orientation = str(output.get("suggestedOrientation") or "white")
    if orientation == "black":
        output["candidates"] = {
            "whiteBottom": _compress_placement(list(reversed(_expand_placement(final) or []))),
            "blackBottom": final,
        }
    else:
        output["candidates"] = {
            "whiteBottom": final,
            "blackBottom": _compress_placement(list(reversed(_expand_placement(final) or []))),
        }

    output["uncertainSquares"] = sorted(
        set(output.get("uncertainSquares", [])) | set(uncertain),
        key=lambda square: (8 - int(square[1]), square[0]),
    )
    if accept:
        type_confidences = [
            float(predictions[square].get("typeConfidence", 0.0))
            for square in final_changed
            if square in predictions
        ]
        specialist_confidence = sum(type_confidences) / len(type_confidences) if type_confidences else 0.0
        base_confidence = float(output.get("averageConfidence", 0.0))
        output["averageConfidence"] = round(max(base_confidence, base_confidence * 0.72 + specialist_confidence * 0.28), 3)
        output["qualityScore"] = round(
            float(output.get("qualityScore", 0.0)) + min(0.18, len(final_changed) * 0.025), 4
        )
    return output


def apply_specialist_model(image_path: Path, result: dict, model_path: Path = MODEL_PATH) -> dict:
    orientation = str(result.get("suggestedOrientation") or "white")
    predictions = predict_board(image_path, orientation, model_path=model_path)
    return apply_specialist_types(result, predictions)
