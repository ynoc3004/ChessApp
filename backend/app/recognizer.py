from __future__ import annotations

from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path

import chess

from .preprocess import ensure_book_variants

PIECES = set("prnbqkPRNBQK")
LOW_CONFIDENCE_THRESHOLD = 0.72


def _expand_rank(rank: str) -> list[str]:
    cells: list[str] = []
    for ch in rank:
        if ch in PIECES:
            cells.append(ch)
        elif ch.isdigit():
            count = int(ch)
            if not 1 <= count <= 8:
                raise ValueError(f"Invalid empty-square count: {ch}")
            cells.extend(["."] * count)
        elif ch in {".", "_"}:
            cells.append(".")
        else:
            raise ValueError(f"Unsupported FEN character from recognizer: {ch!r}")
    if len(cells) != 8:
        raise ValueError(
            f"Recognizer returned a rank with {len(cells)} squares instead of 8: {rank!r}"
        )
    return cells


def _compress_rank(cells: list[str]) -> str:
    out: list[str] = []
    empty = 0
    for ch in cells:
        if ch == ".":
            empty += 1
            continue
        if empty:
            out.append(str(empty))
            empty = 0
        out.append(ch)
    if empty:
        out.append(str(empty))
    return "".join(out)


def _expand_placement(placement: str) -> list[str]:
    ranks = placement.split("/")
    if len(ranks) != 8:
        raise ValueError("Piece placement must contain 8 ranks")
    return [piece for rank in ranks for piece in _expand_rank(rank)]


def _compress_placement(cells: list[str]) -> str:
    if len(cells) != 64:
        raise ValueError("Piece placement must contain 64 squares")
    return "/".join(
        _compress_rank(cells[index : index + 8]) for index in range(0, 64, 8)
    )


def normalize_piece_placement(raw: str) -> str:
    """Normalize recognizer output to standard FEN piece placement."""
    placement = raw.strip().split()[0]
    ranks = placement.split("/")
    if len(ranks) != 8:
        raise ValueError(f"Recognizer returned {len(ranks)} ranks instead of 8")
    return "/".join(_compress_rank(_expand_rank(rank)) for rank in ranks)


def flip_piece_placement_180(placement: str) -> str:
    ranks = [_expand_rank(rank) for rank in placement.split("/")]
    if len(ranks) != 8:
        raise ValueError("Piece placement must contain 8 ranks")
    flipped = [list(reversed(rank)) for rank in reversed(ranks)]
    return "/".join(_compress_rank(rank) for rank in flipped)


def _rotate_square_180(square: str) -> str:
    file_index = ord(square[0]) - ord("a")
    rank = int(square[1])
    return f"{chr(ord('h') - file_index)}{9 - rank}"


def _square_for_fen_index(index: int) -> str:
    row, file_index = divmod(index, 8)
    return f"{chr(ord('a') + file_index)}{8 - row}"


def _pawn_orientation_score(placement: str) -> float:
    """Positive means the diagram is more likely white-at-bottom."""
    ranks = [_expand_rank(rank) for rank in placement.split("/")]
    white_rows: list[int] = []
    black_rows: list[int] = []
    for row_index, row in enumerate(ranks):
        for piece in row:
            if piece == "P":
                white_rows.append(row_index)
            elif piece == "p":
                black_rows.append(row_index)

    if not white_rows or not black_rows:
        return 0.0

    white_avg = sum(white_rows) / len(white_rows)
    black_avg = sum(black_rows) / len(black_rows)
    return max(-1.0, min(1.0, (white_avg - black_avg) / 4.0))


def placement_quality(placement: str) -> dict:
    """Score chess-specific structural sanity independently from ML confidence.

    A recognizer can be confidently wrong. This score prevents an impossible
    position (for example a missing king) from beating a lower-confidence but
    chess-valid candidate.
    """
    try:
        cells = _expand_placement(placement)
    except ValueError:
        return {"valid": False, "score": -10.0, "reasons": ["placement-malformed"]}

    counts = Counter(piece for piece in cells if piece != ".")
    reasons: list[str] = []
    score = 0.0

    if counts["K"] == 1:
        score += 1.6
    else:
        reasons.append(f"white-kings:{counts['K']}")
        score -= 2.4
    if counts["k"] == 1:
        score += 1.6
    else:
        reasons.append(f"black-kings:{counts['k']}")
        score -= 2.4

    for pawn, label in (("P", "white-pawns"), ("p", "black-pawns")):
        if counts[pawn] <= 8:
            score += 0.15
        else:
            reasons.append(f"{label}:{counts[pawn]}")
            score -= 0.8 + 0.15 * (counts[pawn] - 8)

    white_total = sum(counts[piece] for piece in "KQRBNP")
    black_total = sum(counts[piece] for piece in "kqrbnp")
    if white_total > 16:
        reasons.append(f"white-pieces:{white_total}")
        score -= 0.7 + 0.1 * (white_total - 16)
    if black_total > 16:
        reasons.append(f"black-pieces:{black_total}")
        score -= 0.7 + 0.1 * (black_total - 16)

    valid = False
    for turn in ("w", "b"):
        try:
            if chess.Board(f"{placement} {turn} - - 0 1").is_valid():
                valid = True
                break
        except ValueError:
            pass
    if valid:
        score += 2.2
    else:
        reasons.append("python-chess-invalid")
        score -= 1.6

    return {"valid": valid, "score": round(score, 3), "reasons": reasons}


def _position_warnings(placement: str) -> list[str]:
    warnings: list[str] = []
    expanded = "".join(
        ch for rank in placement.split("/") for ch in _expand_rank(rank)
    )

    if expanded.count("K") != 1:
        warnings.append(
            f"AI nhận {expanded.count('K')} vua trắng; thông thường phải có đúng 1."
        )
    if expanded.count("k") != 1:
        warnings.append(
            f"AI nhận {expanded.count('k')} vua đen; thông thường phải có đúng 1."
        )
    if expanded.count("P") > 8:
        warnings.append("AI nhận hơn 8 tốt trắng.")
    if expanded.count("p") > 8:
        warnings.append("AI nhận hơn 8 tốt đen.")

    if not any(
        chess.Board(f"{placement} {turn} - - 0 1").is_valid()
        for turn in ("w", "b")
    ):
        warnings.append(
            "Thế cờ AI đọc được chưa hợp lệ theo luật cờ vua; "
            "hãy kiểm tra lại các quân trước khi phân tích."
        )
    return warnings


@lru_cache(maxsize=1)
def _load_predictor():
    """Load the PyTorch model once per backend process."""
    try:
        from chessimg2pos import ChessPositionPredictor  # type: ignore
        from chessimg2pos.constants import DEFAULT_CLASSIFIER  # type: ignore
        from chessimg2pos.model_loader import download_pretrained_model  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            "Phase 2 AI is not installed. Run: pip install -r requirements.txt"
        ) from exc

    model_path = download_pretrained_model()
    return ChessPositionPredictor(
        model_path=model_path,
        classifier=DEFAULT_CLASSIFIER,
    )


def _confidence_maps(predictions) -> tuple[dict[str, float], dict[str, float]]:
    white: dict[str, float] = {}
    black: dict[str, float] = {}

    for item in predictions:
        square, _piece, probability = item
        confidence = round(float(probability), 3)
        white[str(square)] = confidence
        black[_rotate_square_180(str(square))] = confidence

    return white, black


def _recognize_once(image_path: Path, variant: str) -> dict:
    predictor = _load_predictor()
    detailed = predictor.predict_chessboard(str(image_path))
    raw = str(detailed["fen"])

    white_bottom = normalize_piece_placement(raw)
    black_bottom = flip_piece_placement_180(white_bottom)
    white_confidence, black_confidence = _confidence_maps(
        detailed.get("predictions", [])
    )

    score = _pawn_orientation_score(white_bottom)
    if score < -0.18:
        suggested = "black"
        selected = black_bottom
        selected_confidence = black_confidence
    else:
        suggested = "white"
        selected = white_bottom
        selected_confidence = white_confidence

    confidence_values = list(selected_confidence.values())
    average_confidence = (
        sum(confidence_values) / len(confidence_values)
        if confidence_values
        else 0.0
    )
    uncertain_squares = sorted(
        [
            square
            for square, confidence in selected_confidence.items()
            if confidence < LOW_CONFIDENCE_THRESHOLD
        ],
        key=lambda square: (8 - int(square[1]), square[0]),
    )
    sanity = placement_quality(selected)
    quality_score = (
        average_confidence
        + sanity["score"] * 0.24
        - min(0.35, len(uncertain_squares) / 64 * 0.35)
    )

    return {
        "raw": raw,
        "piecePlacement": selected,
        "suggestedOrientation": suggested,
        "orientationConfidence": round(abs(score), 3),
        "averageConfidence": round(average_confidence, 3),
        "lowConfidenceThreshold": LOW_CONFIDENCE_THRESHOLD,
        "uncertainSquares": uncertain_squares,
        "squareConfidence": selected_confidence,
        "candidates": {
            "whiteBottom": white_bottom,
            "blackBottom": black_bottom,
        },
        "confidenceCandidates": {
            "whiteBottom": white_confidence,
            "blackBottom": black_confidence,
        },
        "warnings": _position_warnings(selected),
        "preprocessVariant": variant,
        "validPlacement": sanity["valid"],
        "placementQuality": sanity["score"],
        "qualityScore": round(quality_score, 4),
        "qualityReasons": sanity["reasons"],
    }


def _fuse_results(results: list[dict]) -> dict | None:
    if len(results) < 2:
        return None

    votes: list[dict[str, float]] = [defaultdict(float) for _ in range(64)]
    confidence_weight: list[dict[str, float]] = [defaultdict(float) for _ in range(64)]
    orientation_votes = Counter()

    for result in results:
        cells = _expand_placement(result["piecePlacement"])
        orientation_votes[result["suggestedOrientation"]] += max(
            0.25, float(result.get("qualityScore", 0.5)) + 0.5
        )
        variant_weight = max(0.35, 1.0 + float(result.get("placementQuality", 0)) * 0.08)
        for index, piece in enumerate(cells):
            square = _square_for_fen_index(index)
            confidence = float(result.get("squareConfidence", {}).get(square, 0.5))
            weight = max(0.05, confidence) * variant_weight
            votes[index][piece] += weight
            confidence_weight[index][piece] += max(0.05, confidence)

    fused_cells: list[str] = []
    fused_confidence: dict[str, float] = {}
    uncertain: list[str] = []
    for index, cell_votes in enumerate(votes):
        winner, winner_weight = max(cell_votes.items(), key=lambda item: item[1])
        total_weight = sum(cell_votes.values()) or 1.0
        agreement = winner_weight / total_weight
        raw_conf = confidence_weight[index][winner] / max(
            1, sum(1 for result in results if _expand_placement(result["piecePlacement"])[index] == winner)
        )
        confidence = min(1.0, raw_conf * 0.72 + agreement * 0.28)
        fused_cells.append(winner)
        square = _square_for_fen_index(index)
        fused_confidence[square] = round(confidence, 3)
        if confidence < LOW_CONFIDENCE_THRESHOLD or agreement < 0.6:
            uncertain.append(square)

    fused = _compress_placement(fused_cells)
    sanity = placement_quality(fused)
    average = sum(fused_confidence.values()) / 64
    quality_score = (
        average
        + sanity["score"] * 0.24
        - min(0.35, len(uncertain) / 64 * 0.35)
        + 0.05
    )
    suggested = orientation_votes.most_common(1)[0][0] if orientation_votes else "white"

    if suggested == "black":
        black_bottom = fused
        white_bottom = flip_piece_placement_180(fused)
        black_confidence = fused_confidence
        white_confidence = {
            _rotate_square_180(square): confidence
            for square, confidence in fused_confidence.items()
        }
    else:
        white_bottom = fused
        black_bottom = flip_piece_placement_180(fused)
        white_confidence = fused_confidence
        black_confidence = {
            _rotate_square_180(square): confidence
            for square, confidence in fused_confidence.items()
        }

    return {
        "raw": fused,
        "piecePlacement": fused,
        "suggestedOrientation": suggested,
        "orientationConfidence": 0.0,
        "averageConfidence": round(average, 3),
        "lowConfidenceThreshold": LOW_CONFIDENCE_THRESHOLD,
        "uncertainSquares": sorted(
            uncertain, key=lambda square: (8 - int(square[1]), square[0])
        ),
        "squareConfidence": fused_confidence,
        "candidates": {
            "whiteBottom": white_bottom,
            "blackBottom": black_bottom,
        },
        "confidenceCandidates": {
            "whiteBottom": white_confidence,
            "blackBottom": black_confidence,
        },
        "warnings": _position_warnings(fused),
        "preprocessVariant": "ensemble",
        "validPlacement": sanity["valid"],
        "placementQuality": sanity["score"],
        "qualityScore": round(quality_score, 4),
        "qualityReasons": sanity["reasons"],
        "ensembleCandidates": len(results),
    }


def recognize_board(image_path: Path) -> dict:
    """Recognize a board using original + old-book preprocessing candidates.

    Candidate selection is legality-aware. A high-confidence impossible board
    can no longer beat a structurally valid candidate purely on confidence.
    """
    if not image_path.exists():
        raise FileNotFoundError(image_path)

    candidates: list[tuple[str, Path]] = [("original", image_path)]
    try:
        candidates.extend(ensure_book_variants(image_path).items())
    except Exception:
        pass

    results: list[dict] = []
    for variant, path in candidates:
        try:
            results.append(_recognize_once(path, variant))
        except Exception:
            continue

    if not results:
        # Preserve the original error semantics when every candidate fails.
        return _recognize_once(image_path, "original")

    fused = _fuse_results(results)
    if fused is not None:
        results.append(fused)

    # Valid chess placements always outrank invalid ones. Within the same
    # validity tier, use the combined ML + structural quality score.
    results.sort(
        key=lambda result: (
            bool(result.get("validPlacement")),
            float(result.get("qualityScore", -999)),
            float(result.get("averageConfidence", 0)),
        ),
        reverse=True,
    )
    winner = dict(results[0])
    winner["ensembleCandidates"] = len(candidates)
    winner["candidateSummary"] = [
        {
            "variant": result.get("preprocessVariant"),
            "valid": bool(result.get("validPlacement")),
            "qualityScore": result.get("qualityScore"),
            "averageConfidence": result.get("averageConfidence"),
            "uncertainSquares": len(result.get("uncertainSquares", [])),
        }
        for result in results
    ]
    return winner
