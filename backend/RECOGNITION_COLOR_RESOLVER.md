# Recognition v3.1 — Piece Color Resolver

Recognition v3.1 separates **piece color** from **piece type** for historical chess-book scans.

Pipeline:

1. Recognition v3 detects whether a square is occupied.
2. `color_vision.py` normalizes the printed 8×8 grid.
3. Very dark **solid core ink** is measured separately from grey diagonal hatch texture.
4. Per-page adaptive clustering estimates whether an occupied piece is black (solid) or white (outlined).
5. The resolver may flip only the FEN case (`P` ↔ `p`, `R` ↔ `r`, etc.). It never changes the piece type.
6. A color correction is accepted only when color agreement improves materially and chess-structure quality does not degrade significantly, or when the correction turns an invalid position into a valid one.
7. Low-confidence color squares remain in the review queue.

The original scanner detector is unchanged.
