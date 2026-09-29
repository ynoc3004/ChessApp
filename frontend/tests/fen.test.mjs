import assert from "node:assert/strict";
import test from "node:test";
import {
  expandPlacement, compressPlacement, movePiece, buildFen, parseFen, lichessAnalysisUrl,
} from "../src/lib/fen.ts";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

test("expand and compress preserve all squares and reject malformed ranks", () => {
  const cells = expandPlacement(START);
  assert.equal(cells.length, 64);
  assert.equal(cells[0], "r");
  assert.equal(cells[60], "K");
  assert.equal(compressPlacement(cells), START);
  assert.throws(() => expandPlacement("8/8/8"), /8 hàng/);
  assert.throws(() => compressPlacement(cells.slice(1)), /64 ô/);
});

test("movePiece changes placement without adding chess legality rules", () => {
  const moved = movePiece(START, "e2", "e4");
  assert.equal(moved, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR");
  assert.equal(movePiece(START, "e4", "e5"), START);
  assert.throws(() => movePiece(START, "z9", "e4"), /Ô cờ/);
});

test("build and parse FEN preserve placement, turn, rights and en passant", () => {
  const fen = buildFen(START, "b", "Kq", "e3");
  assert.equal(fen, `${START} b Kq e3 0 1`);
  assert.deepEqual(parseFen(fen), {
    placement: START, sideToMove: "b", castling: "Kq", enPassant: "e3",
  });
  assert.equal(buildFen(START, "w", "", ""), `${START} w - - 0 1`);
});

test("Lichess analysis URL encodes the FEN fields with underscores", () => {
  assert.equal(lichessAnalysisUrl(`${START} w KQkq - 0 1`),
    `https://lichess.org/analysis/standard/${START}_w_KQkq_-_0_1`);
});
