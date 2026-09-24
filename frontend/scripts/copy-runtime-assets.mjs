import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const copies = [
  [
    join(root, "node_modules", "@scoriiu", "fenshot", "model", "chess-tiles-v2.onnx"),
    join(root, "public", "models", "chess-tiles-v2.onnx"),
  ],
  [
    join(root, "node_modules", "onnxruntime-web", "dist", "ort-wasm-simd-threaded.mjs"),
    join(root, "public", "ort", "ort-wasm-simd-threaded.mjs"),
  ],
  [
    join(root, "node_modules", "onnxruntime-web", "dist", "ort-wasm-simd-threaded.wasm"),
    join(root, "public", "ort", "ort-wasm-simd-threaded.wasm"),
  ],
  [
    join(root, "node_modules", "stockfish", "bin", "stockfish-19-lite-single.js"),
    join(root, "public", "stockfish", "stockfish-19-lite-single.js"),
  ],
  [
    join(root, "node_modules", "stockfish", "bin", "stockfish-19-lite-single.wasm"),
    join(root, "public", "stockfish", "stockfish-19-lite-single.wasm"),
  ],
];

for (const [from, to] of copies) {
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

console.log("Runtime AI + Stockfish assets copied to public/.");
