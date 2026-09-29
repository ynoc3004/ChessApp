import assert from "node:assert/strict";
import test from "node:test";
import { analyzeWithBrowserStockfish } from "../src/lib/browserStockfish.ts";

test("abort terminates the worker instead of leaving Stockfish running", async () => {
  const originalWorker = globalThis.Worker;
  const originalWindow = globalThis.window;
  const workers = [];
  globalThis.window = globalThis;
  globalThis.Worker = class {
    terminated = false;
    constructor() { workers.push(this); }
    postMessage() {}
    terminate() { this.terminated = true; }
  };
  try {
    const controller = new AbortController();
    const pending = analyzeWithBrowserStockfish(
      "4k3/8/8/8/8/8/8/4K3 w - - 0 1", 16, 3, controller.signal,
    );
    assert.equal(workers.length, 1);
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(workers[0].terminated, true);
  } finally {
    globalThis.Worker = originalWorker;
    globalThis.window = originalWindow;
  }
});
