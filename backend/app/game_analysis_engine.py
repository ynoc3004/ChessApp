from __future__ import annotations

import io
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import chess
import chess.engine
import chess.pgn

CATEGORY_META: dict[str, dict[str, Any]] = {
    "opening": {"label": "Khai cuộc", "theme": "opening"},
    "tactical": {"label": "Chiến thuật", "theme": None},
    "calculation": {"label": "Tính toán", "theme": None},
    "material": {"label": "Quản lý quân", "theme": "hangingPiece"},
    "king_safety": {"label": "An toàn Vua", "theme": "exposedKing"},
    "defense": {"label": "Phòng thủ", "theme": "defensiveMove"},
    "endgame": {"label": "Tàn cuộc", "theme": "endgame"},
}
SEVERITY_WEIGHT = {"inaccuracy": 1, "mistake": 2, "blunder": 3}


@dataclass
class EngineSnapshot:
    white_cp: int
    pv: list[str]
    mate_white: int | None = None
    depth: int | None = None


def resolve_engine_path() -> str | None:
    configured = os.getenv("STOCKFISH_PATH", "").strip()
    if configured and Path(configured).exists():
        return configured
    return shutil.which("stockfish")


def parse_pgn(pgn: str) -> chess.pgn.Game:
    text = (pgn or "").strip()
    if not text:
        raise ValueError("Bàn đấu chưa có PGN để phân tích.")
    game = chess.pgn.read_game(io.StringIO(text))
    if game is None:
        raise ValueError("Không đọc được PGN.")
    if game.errors:
        raise ValueError(f"PGN có lỗi: {game.errors[0]}")
    if not list(game.mainline_moves()):
        raise ValueError("PGN chưa có nước đi.")
    return game


def snapshot_from_engine(engine: chess.engine.SimpleEngine, board: chess.Board, depth: int) -> EngineSnapshot:
    info = engine.analyse(board, chess.engine.Limit(depth=depth))
    score = info["score"].pov(chess.WHITE)
    cp = score.score(mate_score=100000)
    value = max(-100000, min(100000, int(cp if cp is not None else 0)))
    return EngineSnapshot(
        white_cp=value,
        pv=[move.uci() for move in info.get("pv", [])[:8]],
        mate_white=score.mate(),
        depth=info.get("depth"),
    )


def _mover_score(snapshot: EngineSnapshot, color: chess.Color) -> int:
    return snapshot.white_cp if color == chess.WHITE else -snapshot.white_cp


def _is_endgame(board: chess.Board) -> bool:
    material = 0
    for piece_type, value in ((chess.QUEEN, 9), (chess.ROOK, 5), (chess.BISHOP, 3), (chess.KNIGHT, 3)):
        material += len(board.pieces(piece_type, chess.WHITE)) * value
        material += len(board.pieces(piece_type, chess.BLACK)) * value
    return material <= 12 or len(board.piece_map()) <= 10


def _first_move(board: chess.Board, snapshot: EngineSnapshot) -> chess.Move | None:
    if not snapshot.pv:
        return None
    try:
        move = chess.Move.from_uci(snapshot.pv[0])
    except ValueError:
        return None
    return move if move in board.legal_moves else None


def classify_category(
    board_before: chess.Board,
    board_after: chess.Board,
    before: EngineSnapshot,
    after: EngineSnapshot,
    mover_score_before: int,
    cp_loss: int,
) -> str:
    """Return a heuristic training category, not a claim about cognition."""
    if _is_endgame(board_before):
        return "endgame"

    reply = _first_move(board_after, after)
    if reply is not None:
        victim = board_after.piece_at(reply.to_square) if board_after.is_capture(reply) else None
        probe = board_after.copy()
        try:
            probe.push(reply)
            checking_reply = probe.is_check()
        except AssertionError:
            checking_reply = False
        if checking_reply and cp_loss >= 100:
            return "king_safety"
        if victim is not None and victim.piece_type in {chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT} and cp_loss >= 100:
            return "material"

    best = _first_move(board_before, before)
    if best is not None:
        probe = board_before.copy()
        tactical = board_before.is_capture(best) or best.promotion is not None
        try:
            probe.push(best)
            tactical = tactical or probe.is_check()
        except AssertionError:
            pass
        if tactical and cp_loss >= 90:
            return "tactical"

    if mover_score_before <= -120 and cp_loss >= 90:
        return "defense"
    if board_before.ply() < 20:
        return "opening"
    return "calculation"


def severity_for_loss(cp_loss: int) -> str | None:
    if cp_loss >= 300:
        return "blunder"
    if cp_loss >= 150:
        return "mistake"
    if cp_loss >= 80:
        return "inaccuracy"
    return None


def analyze_game_with_evaluator(pgn: str, white_id: str, black_id: str, evaluator) -> tuple[int, list[dict[str, Any]]]:
    game = parse_pgn(pgn)
    board = game.board()
    current = evaluator(board.copy())
    moments: list[dict[str, Any]] = []
    moves = list(game.mainline_moves())

    for index, move in enumerate(moves, start=1):
        mover = board.turn
        student_id = white_id if mover == chess.WHITE else black_id
        board_before = board.copy()
        fen_before = board_before.fen()
        san = board_before.san(move)
        best_score = _mover_score(current, mover)
        best_move = current.pv[0] if current.pv else None
        best_line = " ".join(current.pv[:6])
        board.push(move)
        after = evaluator(board.copy())
        played_score = _mover_score(after, mover)
        cp_loss = max(0, min(5000, best_score - played_score))
        severity = severity_for_loss(cp_loss)
        if severity:
            missed_win = best_score >= 250 and played_score < 100 and cp_loss >= 150
            category = classify_category(board_before, board.copy(), current, after, best_score, cp_loss)
            moments.append({
                "studentId": student_id,
                "ply": index,
                "moveNo": (index + 1) // 2,
                "color": "white" if mover == chess.WHITE else "black",
                "san": san,
                "uci": move.uci(),
                "fenBefore": fen_before,
                "bestMoveUci": best_move,
                "bestLine": best_line,
                "bestScoreCp": best_score,
                "playedScoreCp": played_score,
                "cpLoss": cp_loss,
                "severity": severity,
                "missedWin": missed_win,
                "category": category,
                "categoryLabel": CATEGORY_META[category]["label"],
            })
        current = after
    return len(moves), moments


def analyze_pgn_stockfish(pgn: str, white_id: str, black_id: str, depth: int) -> tuple[int, list[dict[str, Any]]]:
    engine_path = resolve_engine_path()
    if not engine_path:
        raise RuntimeError("STOCKFISH_PATH chưa được cấu hình hoặc Stockfish không có trong PATH.")
    engine = None
    try:
        engine = chess.engine.SimpleEngine.popen_uci(engine_path)
        return analyze_game_with_evaluator(
            pgn,
            white_id,
            black_id,
            lambda board: snapshot_from_engine(engine, board, depth),
        )
    finally:
        if engine is not None:
            try:
                engine.quit()
            except Exception:
                pass
