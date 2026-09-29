import assert from "node:assert/strict";
import test from "node:test";
import { API_BASE, resolveImageUrl } from "../src/lib/api.ts";

test("relative and previously saved localhost image paths use the configured API origin", () => {
  const expected = `${API_BASE}/files/abc/position-0001.png`;
  assert.equal(resolveImageUrl("/files/abc/position-0001.png"), expected);
  assert.equal(resolveImageUrl("http://localhost:8000/files/abc/position-0001.png"), expected);
  assert.equal(resolveImageUrl("http://127.0.0.1:8000/files/abc/position-0001.png"), expected);
});
