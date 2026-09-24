from __future__ import annotations

import json
from pathlib import Path

import chess
import cv2
import numpy as np

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_DIR / "data"
LEARNING_DIR = DATA_DIR / "learning_corrections"
OUT_DIR = DATA_DIR / "user_training_corpus"

TILE_SIZE = 32
BOARD_SIZE = TILE_SIZE * 8


def rotate_square_180(square: chess.Square) -> chess.Square:
    file_index = chess.square_file(square)
    rank_index = chess.square_rank(square)
    return chess.square(7 - file_index, 7 - rank_index)


def crop_board(image: np.ndarray, corners: dict | None) -> np.ndarray:
    height, width = image.shape[:2]
    if corners:
        x0 = max(0, min(width - 1, int(round(corners["x0"]))))
        y0 = max(0, min(height - 1, int(round(corners["y0"]))))
        x1 = max(x0 + 1, min(width, int(round(corners["x1"]))))
        y1 = max(y0 + 1, min(height, int(round(corners["y1"]))))
        board = image[y0:y1, x0:x1]
    else:
        # Old samples without detector corners: the backend detector already
        # stores a tight square crop, so use the largest centered square.
        side = min(height, width)
        x0 = (width - side) // 2
        y0 = (height - side) // 2
        board = image[y0 : y0 + side, x0 : x0 + side]

    return cv2.resize(board, (BOARD_SIZE, BOARD_SIZE), interpolation=cv2.INTER_AREA)


def board_labels(fen: str, image_orientation: str | None) -> str:
    board = chess.Board(fen)
    labels: list[str] = []

    # Fenshot's classifier tile order is A1..H1, A2..H2 ... A8..H8.
    for rank in range(1, 9):
        for file_index in range(8):
            raw_square = chess.square(file_index, rank - 1)
            actual_square = (
                rotate_square_180(raw_square)
                if image_orientation == "black"
                else raw_square
            )
            piece = board.piece_at(actual_square)
            labels.append(piece.symbol() if piece else "1")

    return "".join(labels)


def board_tiles(board_image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(board_image, cv2.COLOR_BGR2GRAY)
    tiles: list[np.ndarray] = []

    # Input image rows are rank 8 -> rank 1. Training order is A1 -> H8.
    for rank in range(1, 9):
        image_row = 8 - rank
        y0 = image_row * TILE_SIZE
        for file_index in range(8):
            x0 = file_index * TILE_SIZE
            tile = gray[y0 : y0 + TILE_SIZE, x0 : x0 + TILE_SIZE]
            tiles.append(tile.reshape(-1))

    return np.stack(tiles).astype(np.uint8)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    all_tiles: list[np.ndarray] = []
    label_lines: list[str] = []
    used = 0
    skipped = 0

    for meta_path in sorted(LEARNING_DIR.glob("*.json")):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            image_path = LEARNING_DIR / meta["image"]
            fen = meta["correctedFen"]
            image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
            if image is None:
                raise ValueError("image missing")

            cropped = crop_board(image, meta.get("corners"))
            tiles = board_tiles(cropped)
            labels = board_labels(fen, meta.get("imageOrientation"))

            if tiles.shape != (64, 1024) or len(labels) != 64:
                raise ValueError("unexpected tile shape")

            all_tiles.append(tiles)
            label_lines.append(labels)
            used += 1
        except Exception as exc:
            skipped += 1
            print(f"skip {meta_path.name}: {exc}")

    if not all_tiles:
        raise SystemExit(
            "No correction samples yet. Save corrected positions in the web UI first."
        )

    corpus = np.concatenate(all_tiles, axis=0)
    bin_path = OUT_DIR / "shard-user.bin"
    labels_path = OUT_DIR / "shard-user.labels"

    bin_path.write_bytes(corpus.tobytes())
    labels_path.write_text("\n".join(label_lines) + "\n", encoding="utf-8")

    print(f"built {used} boards / {len(corpus)} tiles")
    print(f"skipped {skipped}")
    print(f"tiles:  {bin_path}")
    print(f"labels: {labels_path}")
    print(
        "This corpus matches Fenshot's 13-class tile format "
        "(1KQRBNPkqrbnp) and can be mixed with a larger corpus for retraining."
    )


if __name__ == "__main__":
    main()
