import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const partsDir = path.join(root, "assets", "immortal-theme");
const outputDir = path.join(root, "public", "dao");
const outputPath = path.join(outputDir, "immortal-theme.webp");

const parts = Array.from({ length: 5 }, (_, index) =>
  fs.readFileSync(path.join(partsDir, `part${index}.txt`), "utf8").trim()
);

const base64 = parts.join("");
if (base64.length !== 37920) {
  throw new Error(`immortal-theme base64 length mismatch: ${base64.length}`);
}

const data = Buffer.from(base64, "base64");
if (data.length !== 28438) {
  throw new Error(`immortal-theme byte length mismatch: ${data.length}`);
}

const sha256 = crypto.createHash("sha256").update(data).digest("hex");
const expectedSha256 = "46fb951c8e4f38ee04fc6f27a97ebc761912fecc23133a25a6f704361d3b2e76";
if (sha256 !== expectedSha256) {
  throw new Error(`immortal-theme checksum mismatch: ${sha256}`);
}

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, data);
console.log(`[immortal-theme] rebuilt ${outputPath} (${data.length} bytes)`);
