import assert from "node:assert/strict";
import test from "node:test";
import { scoreForWhite, scoreLabel, shareForWhite, verdict } from "../src/lib/engineEvaluation.ts";

const line = (evaluation, mate = null) => ({ evaluation, mate, depth: 14, san: "Qh5", uci: "d1h5", multipv: 1 });
const white = "8/8/8/8/8/8/8/8 w - - 0 1";
const black = "8/8/8/8/8/8/8/8 b - - 0 1";

test("Stockfish score is reported from White's perspective regardless of turn", () => {
  assert.equal(scoreLabel(scoreForWhite(line(1.25), white)), "+1.25");
  const blackTurn = scoreForWhite(line(1.25), black);
  assert.equal(scoreLabel(blackTurn), "-1.25");
  assert.equal(verdict(blackTurn), "Đen có ưu thế");
  assert.ok(shareForWhite(blackTurn) < 50);
  assert.equal(verdict(scoreForWhite(line(0.2), white)), "Thế cờ cân bằng");
});

test("mate score identifies the side that can deliver mate", () => {
  const blackTurn = scoreForWhite(line(0, 2), black);
  assert.equal(scoreLabel(blackTurn), "M-2");
  assert.equal(verdict(blackTurn), "Đen có đường chiếu hết");
  assert.equal(shareForWhite(blackTurn), 2);
  assert.equal(scoreLabel(scoreForWhite(line(0, -3), black)), "M+3");
});
