import { Chess } from "chess.js";

type Orientation = "white" | "black";

export type RecognitionCorners = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type RecognitionCandidate = {
  name: string;
  url: string;
};

export type BrowserRecognition = {
  placement: string;
  rawPlacement: string;
  orientation: Orientation;
  meanConfidence: number;
  minConfidence: number;
  reliable: boolean;
  plausible: boolean;
  validPlacement: boolean;
  placementQuality: number;
  qualityReasons: string[];
  squareConfidence: Record<string, number>;
  confidenceCandidates: {
    whiteBottom: Record<string, number>;
    blackBottom: Record<string, number>;
  };
  uncertainSquares: string[];
  whiteBottom: string;
  blackBottom: string;
  corners: RecognitionCorners;
  variant: string;
  ensembleScore: number;
};

let recognizerPromise: Promise<{
  recognizer: import("@scoriiu/fenshot").Recognizer;
  resolveOrientation: typeof import("@scoriiu/fenshot").resolveOrientation;
  flipPlacement: typeof import("@scoriiu/fenshot").flipPlacement;
}> | null = null;

function squareForIndex(index: number): string {
  const file = String.fromCharCode(97 + (index % 8));
  const rank = Math.floor(index / 8) + 1;
  return `${file}${rank}`;
}

function squareForFenIndex(index: number): string {
  const file = String.fromCharCode(97 + (index % 8));
  const rank = 8 - Math.floor(index / 8);
  return `${file}${rank}`;
}

function rotateSquare180(square: string): string {
  const fileIndex = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  return `${String.fromCharCode(104 - fileIndex)}${9 - rank}`;
}

function expandPlacement(placement: string): string[] {
  const out: string[] = [];
  for (const rank of placement.split("/")) {
    for (const ch of rank) {
      if (/^[1-8]$/.test(ch)) {
        for (let i = 0; i < Number(ch); i += 1) out.push(".");
      } else {
        out.push(ch);
      }
    }
  }
  return out;
}

function compressPlacement(cells: string[]): string {
  if (cells.length !== 64) return "8/8/8/8/8/8/8/8";
  const ranks: string[] = [];
  for (let row = 0; row < 8; row += 1) {
    let empty = 0;
    let rank = "";
    for (const piece of cells.slice(row * 8, row * 8 + 8)) {
      if (piece === ".") {
        empty += 1;
      } else {
        if (empty) rank += String(empty);
        empty = 0;
        rank += piece;
      }
    }
    if (empty) rank += String(empty);
    ranks.push(rank);
  }
  return ranks.join("/");
}

function flipPlacement180(placement: string): string {
  const cells = expandPlacement(placement);
  return cells.length === 64 ? compressPlacement([...cells].reverse()) : placement;
}

function placementAgreement(a: string, b: string): number {
  const aa = expandPlacement(a);
  const bb = expandPlacement(b);
  if (aa.length !== 64 || bb.length !== 64) return 0;
  let same = 0;
  for (let i = 0; i < 64; i += 1) {
    if (aa[i] === bb[i]) same += 1;
  }
  return same / 64;
}

export function placementSanity(placement: string) {
  const cells = expandPlacement(placement);
  if (cells.length !== 64) {
    return { valid: false, score: -10, reasons: ["placement-malformed"] };
  }

  const count = (piece: string) => cells.filter((cell) => cell === piece).length;
  const reasons: string[] = [];
  let score = 0;

  const whiteKings = count("K");
  const blackKings = count("k");
  if (whiteKings === 1) score += 1.6;
  else { score -= 2.4; reasons.push(`white-kings:${whiteKings}`); }
  if (blackKings === 1) score += 1.6;
  else { score -= 2.4; reasons.push(`black-kings:${blackKings}`); }

  const whitePawns = count("P");
  const blackPawns = count("p");
  if (whitePawns <= 8) score += 0.15;
  else { score -= 0.8 + (whitePawns - 8) * 0.15; reasons.push(`white-pawns:${whitePawns}`); }
  if (blackPawns <= 8) score += 0.15;
  else { score -= 0.8 + (blackPawns - 8) * 0.15; reasons.push(`black-pawns:${blackPawns}`); }

  const whiteTotal = cells.filter((cell) => /[KQRBNP]/.test(cell)).length;
  const blackTotal = cells.filter((cell) => /[kqrbnp]/.test(cell)).length;
  if (whiteTotal > 16) { score -= 0.7 + (whiteTotal - 16) * 0.1; reasons.push(`white-pieces:${whiteTotal}`); }
  if (blackTotal > 16) { score -= 0.7 + (blackTotal - 16) * 0.1; reasons.push(`black-pieces:${blackTotal}`); }

  let valid = false;
  for (const turn of ["w", "b"] as const) {
    try {
      const board = new Chess(`${placement} ${turn} - - 0 1`);
      // chess.js constructor validation catches malformed/impossible basics;
      // kings are checked explicitly above because historical versions are
      // intentionally permissive for editor positions.
      if (board && whiteKings === 1 && blackKings === 1) {
        valid = true;
        break;
      }
    } catch {}
  }
  if (valid) score += 2.2;
  else { score -= 1.6; reasons.push("chess-invalid"); }

  return { valid, score, reasons };
}

async function getRecognizer() {
  if (!recognizerPromise) {
    recognizerPromise = import("@scoriiu/fenshot").then((mod) => ({
      recognizer: mod.createRecognizer({
        modelUrl: "/models/chess-tiles-v2.onnx",
        wasmPaths: "/ort/",
      }),
      resolveOrientation: mod.resolveOrientation,
      flipPlacement: mod.flipPlacement,
    }));
  }
  return recognizerPromise;
}

export async function warmUpBookRecognizer() {
  const loaded = await getRecognizer();
  loaded.recognizer.warmUp();
}

export async function recognizeBookDiagram(
  imageUrl: string,
  variant = "original",
): Promise<BrowserRecognition | null> {
  const loaded = await getRecognizer();
  const response = await fetch(imageUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Không tải được ảnh bàn cờ để AI nhận dạng.");
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const detectScale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));

  try {
    const scan = await loaded.recognizer.recognize(bitmap);
    if (!scan) return null;

    const plausible = (scan as unknown as { plausible?: boolean }).plausible ?? true;
    const resolved = loaded.resolveOrientation(scan.placement);
    const whiteBottom = scan.placement;
    const blackBottom = loaded.flipPlacement(scan.placement);

    const whiteConfidence: Record<string, number> = {};
    const blackConfidence: Record<string, number> = {};

    scan.confidences.forEach((confidence, index) => {
      const square = squareForIndex(index);
      whiteConfidence[square] = confidence;
      blackConfidence[rotateSquare180(square)] = confidence;
    });

    const selectedConfidence = resolved.orientation === "black" ? blackConfidence : whiteConfidence;
    const uncertainSquares = Object.entries(selectedConfidence)
      .filter(([, confidence]) => confidence < 0.7)
      .map(([square]) => square)
      .sort((a, b) => (8 - Number(a[1])) - (8 - Number(b[1])) || a.localeCompare(b));

    const corners = {
      x0: scan.corners.x0 / detectScale,
      y0: scan.corners.y0 / detectScale,
      x1: scan.corners.x1 / detectScale,
      y1: scan.corners.y1 / detectScale,
    };
    const sanity = placementSanity(resolved.placement);

    return {
      placement: resolved.placement,
      rawPlacement: scan.placement,
      orientation: resolved.orientation,
      meanConfidence: scan.meanConfidence,
      minConfidence: scan.minConfidence,
      reliable: scan.reliable,
      plausible,
      validPlacement: sanity.valid,
      placementQuality: sanity.score,
      qualityReasons: sanity.reasons,
      squareConfidence: selectedConfidence,
      confidenceCandidates: { whiteBottom: whiteConfidence, blackBottom: blackConfidence },
      uncertainSquares,
      whiteBottom,
      blackBottom,
      corners,
      variant,
      ensembleScore: 0,
    };
  } finally {
    bitmap.close();
  }
}

function fuseRecognitions(results: BrowserRecognition[]): BrowserRecognition | null {
  if (results.length < 2) return null;

  const votes = Array.from({ length: 64 }, () => new Map<string, number>());
  const confidenceVotes = Array.from({ length: 64 }, () => new Map<string, number[]>());
  const orientationWeight = { white: 0, black: 0 };

  for (const result of results) {
    const cells = expandPlacement(result.placement);
    if (cells.length !== 64) continue;
    const resultWeight = Math.max(0.35, 1 + result.placementQuality * 0.08);
    orientationWeight[result.orientation] += Math.max(0.25, result.meanConfidence + (result.validPlacement ? 0.4 : 0));

    cells.forEach((piece, index) => {
      const square = squareForFenIndex(index);
      const confidence = result.squareConfidence[square] ?? 0.5;
      votes[index].set(piece, (votes[index].get(piece) ?? 0) + Math.max(0.05, confidence) * resultWeight);
      const list = confidenceVotes[index].get(piece) ?? [];
      list.push(confidence);
      confidenceVotes[index].set(piece, list);
    });
  }

  const cells: string[] = [];
  const squareConfidence: Record<string, number> = {};
  const uncertainSquares: string[] = [];
  let minConfidence = 1;

  votes.forEach((cellVotes, index) => {
    const sorted = [...cellVotes.entries()].sort((a, b) => b[1] - a[1]);
    const [piece, winningWeight] = sorted[0] ?? [".", 0];
    const totalWeight = sorted.reduce((sum, [, weight]) => sum + weight, 0) || 1;
    const agreement = winningWeight / totalWeight;
    const confidences = confidenceVotes[index].get(piece) ?? [0.5];
    const meanModelConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const confidence = Math.min(1, meanModelConfidence * 0.72 + agreement * 0.28);
    const square = squareForFenIndex(index);
    cells.push(piece);
    squareConfidence[square] = confidence;
    minConfidence = Math.min(minConfidence, confidence);
    if (confidence < 0.7 || agreement < 0.6) uncertainSquares.push(square);
  });

  const placement = compressPlacement(cells);
  const sanity = placementSanity(placement);
  const meanConfidence = Object.values(squareConfidence).reduce((a, b) => a + b, 0) / 64;
  const orientation: Orientation = orientationWeight.black > orientationWeight.white ? "black" : "white";
  const whiteBottom = orientation === "white" ? placement : flipPlacement180(placement);
  const blackBottom = orientation === "black" ? placement : flipPlacement180(placement);
  const confidenceCandidates = orientation === "white"
    ? {
        whiteBottom: squareConfidence,
        blackBottom: Object.fromEntries(Object.entries(squareConfidence).map(([square, confidence]) => [rotateSquare180(square), confidence])),
      }
    : {
        whiteBottom: Object.fromEntries(Object.entries(squareConfidence).map(([square, confidence]) => [rotateSquare180(square), confidence])),
        blackBottom: squareConfidence,
      };

  const representative = [...results].sort((a, b) => b.meanConfidence - a.meanConfidence)[0];
  return {
    ...representative,
    placement,
    rawPlacement: placement,
    orientation,
    meanConfidence,
    minConfidence,
    reliable: uncertainSquares.length <= 8,
    plausible: sanity.valid,
    validPlacement: sanity.valid,
    placementQuality: sanity.score,
    qualityReasons: sanity.reasons,
    squareConfidence,
    confidenceCandidates,
    uncertainSquares,
    whiteBottom,
    blackBottom,
    variant: "ensemble",
    ensembleScore: 0,
  };
}

export async function recognizeBookDiagramEnsemble(
  candidates: RecognitionCandidate[],
): Promise<BrowserRecognition | null> {
  const results: BrowserRecognition[] = [];

  for (const candidate of candidates) {
    try {
      const result = await recognizeBookDiagram(candidate.url, candidate.name);
      if (result) results.push(result);
    } catch {
      // One preprocessing candidate may fail board detection; the
      // remaining candidates can still produce a useful answer.
    }
  }

  if (!results.length) return null;
  const fused = fuseRecognitions(results);
  if (fused) results.push(fused);

  const scored = results.map((result) => {
    const otherResults = results.filter((item) => item !== result && item.variant !== "ensemble");
    const consensus = otherResults.length
      ? otherResults.reduce((sum, item) => sum + placementAgreement(result.placement, item.placement), 0) / otherResults.length
      : 0;

    const score =
      result.meanConfidence +
      result.minConfidence * 0.14 +
      result.placementQuality * 0.24 +
      (result.validPlacement ? 0.9 : -0.9) +
      (result.plausible ? 0.14 : 0) +
      (result.reliable ? 0.08 : 0) +
      consensus * 0.24 -
      Math.min(0.3, result.uncertainSquares.length / 64 * 0.3) +
      (result.variant === "ensemble" ? 0.05 : 0);

    return { ...result, ensembleScore: score };
  });

  scored.sort((a, b) => {
    if (a.validPlacement !== b.validPlacement) return a.validPlacement ? -1 : 1;
    return b.ensembleScore - a.ensembleScore;
  });
  return scored[0];
}
