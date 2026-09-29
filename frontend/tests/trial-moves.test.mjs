import assert from "node:assert/strict";
import test from "node:test";
import { moveFen, promotionRequired } from "../src/lib/trialMoves.ts";

test("trial move keeps the complete FEN so undo can restore the exact snapshot", () => {
  const before = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const after = moveFen(before, "e2", "e4");
  assert.match(after, /^rnbqkbnr\/pppppppp\/8\/8\/4P3\/8\/PPPP1PPP\/RNBQKBNR b KQkq - 0 1$/);
  assert.equal(before.split(" ")[1], "w");
});

test("promotion requests a choice and supports all four pieces", () => {
  const before = "4k3/P7/8/8/8/8/8/4K3 w - - 0 1";
  assert.equal(promotionRequired(before, "a7", "a8"), true);
  for (const [piece, expected] of [["q", "Q"], ["r", "R"], ["b", "B"], ["n", "N"]]) {
    assert.equal(moveFen(before, "a7", "a8", piece).split("/")[0], `${expected}3k3`);
  }
});
