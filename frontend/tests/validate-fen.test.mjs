import assert from "node:assert/strict";
import test from "node:test";
import { validateFen } from "../src/lib/validateFen.ts";

const ordinary = [
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "4k3/8/8/8/8/8/8/4K3 w - - 0 1",
  "4k3/4R3/8/8/8/8/8/4K3 b - - 0 1",
];

test("ordinary positions, including a king in check on its own turn, remain valid", () => {
  for (const fen of ordinary) assert.equal(validateFen(fen).valid, true, fen);
});

test("positions rejected by python-chess have a user-facing reason", () => {
  const invalid = [
    "4k3/4R3/8/8/8/8/8/4K3 w - - 0 1",
    "4k3/8/8/8/8/P7/PPPPPPPP/4K3 w - - 0 1",
    "8/8/8/8/8/8/4k3/4K3 w - - 0 1",
    "4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1",
  ];
  for (const fen of invalid) {
    const result = validateFen(fen);
    assert.equal(result.valid, false, fen);
    assert.ok(result.reason.length > 0, fen);
  }
});
