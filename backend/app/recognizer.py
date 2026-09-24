from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import chess

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

    board = chess.Board(f"{placement} w - - 0 1")
    if not board.is_valid():
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


def recognize_board(image_path: Path) -> dict:
    if not image_path.exists():
        raise FileNotFoundError(image_path)

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
    }
