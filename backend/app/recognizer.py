from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import chess

PIECES = set("prnbqkPRNBQK")


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
        raise ValueError(f"Recognizer returned a rank with {len(cells)} squares instead of 8: {rank!r}")
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
    expanded = "".join(ch for rank in placement.split("/") for ch in _expand_rank(rank))

    if expanded.count("K") != 1:
        warnings.append(f"AI nhận {expanded.count('K')} vua trắng; thông thường phải có đúng 1.")
    if expanded.count("k") != 1:
        warnings.append(f"AI nhận {expanded.count('k')} vua đen; thông thường phải có đúng 1.")
    if expanded.count("P") > 8:
        warnings.append("AI nhận hơn 8 tốt trắng.")
    if expanded.count("p") > 8:
        warnings.append("AI nhận hơn 8 tốt đen.")

    board = chess.Board(f"{placement} w - - 0 1")
    if not board.is_valid():
        warnings.append("Thế cờ AI đọc được chưa hợp lệ theo luật cờ vua; hãy kiểm tra lại các quân trước khi chạy Stockfish.")
    return warnings


@lru_cache(maxsize=1)
def _load_predict_fen():
    try:
        from chessimg2pos import predict_fen  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            "Phase 2 AI is not installed. Run: pip install -r requirements.txt"
        ) from exc
    return predict_fen


def recognize_board(image_path: Path) -> dict:
    if not image_path.exists():
        raise FileNotFoundError(image_path)

    predict_fen = _load_predict_fen()
    raw = str(predict_fen(str(image_path)))
    white_bottom = normalize_piece_placement(raw)
    black_bottom = flip_piece_placement_180(white_bottom)

    score = _pawn_orientation_score(white_bottom)
    if score < -0.18:
        suggested = "black"
        selected = black_bottom
    else:
        suggested = "white"
        selected = white_bottom

    return {
        "raw": raw,
        "piecePlacement": selected,
        "suggestedOrientation": suggested,
        "orientationConfidence": round(abs(score), 3),
        "candidates": {
            "whiteBottom": white_bottom,
            "blackBottom": black_bottom,
        },
        "warnings": _position_warnings(selected),
    }
