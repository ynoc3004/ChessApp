# Recognition v4 — Local 13-class Specialist

Recognition v4 learns the exact printed piece style from ChessApp's own manual corrections.

## Classes

The model stores 13 supervised labels:

- `.` empty
- `K Q R B N P` white pieces
- `k q r b n p` black pieces

Training data comes from `backend/data/learning_corrections/`. Each corrected board is normalized to an 8×8 grid and split into 64 labeled tiles using the saved `imageOrientation`.

## Model

The first local specialist uses compact OpenCV/NumPy shape features and a capped prototype bank. It deliberately has no new runtime dependency and trains quickly on a normal laptop. The artifact is written under `backend/data/models/`, which is already ignored by Git.

The model learns 13 labels, but during inference it is used conservatively:

1. Recognition v3 decides occupancy.
2. Recognition v3.1 resolves white/black color.
3. Recognition v4 predicts piece type from the user's corrected book style.
4. V4 may change `R -> Q`, `B -> P`, etc. only on a square already occupied by the base recognizer.
5. V4 preserves the color chosen by v3.1 and never creates/deletes a piece.
6. A correction needs sufficient type confidence and margin and must not materially damage chess-structure quality.
7. If the local model is missing/corrupt, ChessApp automatically falls back to the existing recognizer.

## Training

Open `/admin/model` and press **Huấn luyện lại model**. Training:

- rebuilds the local prototype bank from all usable corrections;
- reports class coverage and held-out validation when enough boards exist;
- skips samples with missing image, invalid corrected FEN, or unknown orientation instead of guessing labels;
- clears old `position-*.recognition.json` caches after a successful train;
- preserves every `position-*.user.json` manual correction.

After adding new corrections the model status becomes **stale** until it is trained again.
