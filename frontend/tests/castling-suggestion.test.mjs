import assert from "node:assert/strict";
import test from "node:test";
import { castlingSuggestion } from "../src/lib/castlingSuggestion.ts";

test("suggests rights only for kings and rooks on their starting squares", () => {
  assert.equal(castlingSuggestion("r3k2r/8/8/8/8/8/8/R3K2R"), "KQkq");
  assert.equal(castlingSuggestion("4k2r/8/8/8/8/8/8/R3K3"), "Qk");
  assert.equal(castlingSuggestion("4k3/8/8/8/8/8/8/4K3"), "-");
});
