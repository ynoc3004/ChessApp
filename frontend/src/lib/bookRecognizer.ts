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

export type BoardVision = {
  method: "non-diagonal-gradient-v1";
  occupancy: Record<string, number>;
  edgeDensity: Record<string, number>;
  occupiedSquares: string[];
  occupancyThreshold: number;
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
  vision?: BoardVision;
  occupancyAgreement?: number;
  visionMismatchSquares?: string[];
};

let recognizerPromise: Promise<{
  recognizer: import("@scoriiu/fenshot").Recognizer;
  resolveOrientation: typeof import("@scoriiu/fenshot").resolveOrientation;
  flipPlacement: typeof import("@scoriiu/fenshot").flipPlacement;
}> | null = null;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

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

function adaptiveVisionThreshold(densities: number[]) {
  let low = Math.min(...densities);
  let high = Math.max(...densities);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high - low < 0.005) return 0.05;

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const lowValues: number[] = [];
    const highValues: number[] = [];
    for (const value of densities) {
      if (Math.abs(value - low) <= Math.abs(value - high)) lowValues.push(value);
      else highValues.push(value);
    }
    if (lowValues.length) low = lowValues.reduce((a, b) => a + b, 0) / lowValues.length;
    if (highValues.length) high = highValues.reduce((a, b) => a + b, 0) / highValues.length;
  }

  return clamp(((low + high) / 2) * 0.68, 0.045, 0.07);
}

/**
 * Old printed boards use diagonal hatch texture on half the cells. Darkness is
 * therefore a poor occupancy signal. This independent CV pass measures strong
 * edges that are *not* diagonal: hatch strokes largely disappear while rooks,
 * pawns, kings and piece outlines remain obvious.
 */
async function analyzeBitmapOccupancy(bitmap: ImageBitmap, variant: string): Promise<BoardVision> {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return { method: "non-diagonal-gradient-v1", occupancy: {}, edgeDensity: {}, occupiedSquares: [], occupancyThreshold: 0.05 };
  }

  const rawSide = Math.min(bitmap.width, bitmap.height);
  const trimRatio = variant.startsWith("grid") ? 0 : 0.02;
  const trim = rawSide * trimRatio;
  const sourceSide = Math.max(8, rawSide - trim * 2);
  const sourceX = (bitmap.width - rawSide) / 2 + trim;
  const sourceY = (bitmap.height - rawSide) / 2 + trim;
  context.drawImage(bitmap, sourceX, sourceY, sourceSide, sourceSide, 0, 0, size, size);

  const rgba = context.getImageData(0, 0, size, size).data;
  const gray = new Float32Array(size * size);
  for (let index = 0, pixel = 0; index < rgba.length; index += 4, pixel += 1) {
    gray[pixel] = rgba[index] * 0.299 + rgba[index + 1] * 0.587 + rgba[index + 2] * 0.114;
  }

  const magnitude = new Float32Array(size * size);
  const angle = new Float32Array(size * size);
  const sample: number[] = [];
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const i = y * size + x;
      const tl = gray[i - size - 1];
      const tc = gray[i - size];
      const tr = gray[i - size + 1];
      const ml = gray[i - 1];
      const mr = gray[i + 1];
      const bl = gray[i + size - 1];
      const bc = gray[i + size];
      const br = gray[i + size + 1];
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const mag = Math.hypot(gx, gy);
      let degrees = (Math.atan2(gy, gx) * 180) / Math.PI;
      if (degrees < 0) degrees += 180;
      if (degrees >= 180) degrees -= 180;
      magnitude[i] = mag;
      angle[i] = degrees;
      if (x % 4 === 0 && y % 4 === 0) sample.push(mag);
    }
  }

  sample.sort((a, b) => a - b);
  const percentile75 = sample[Math.floor(sample.length * 0.75)] ?? 35;
  const strongThreshold = Math.max(35, percentile75);
  const cellSize = size / 8;
  const margin = Math.round(cellSize * 0.125);
  const densities: number[] = [];

  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      let nonDiagonal = 0;
      let pixels = 0;
      const y0 = Math.round(row * cellSize) + margin;
      const y1 = Math.round((row + 1) * cellSize) - margin;
      const x0 = Math.round(column * cellSize) + margin;
      const x1 = Math.round((column + 1) * cellSize) - margin;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = y * size + x;
          const degrees = angle[i];
          const diagonal = (degrees > 25 && degrees < 65) || (degrees > 115 && degrees < 155);
          if (magnitude[i] > strongThreshold && !diagonal) nonDiagonal += 1;
          pixels += 1;
        }
      }
      densities.push(pixels ? nonDiagonal / pixels : 0);
    }
  }

  const occupancyThreshold = adaptiveVisionThreshold(densities);
  const scale = Math.max(0.012, occupancyThreshold * 0.24);
  const occupancy: Record<string, number> = {};
  const edgeDensity: Record<string, number> = {};
  const occupiedSquares: string[] = [];

  densities.forEach((density, index) => {
    const square = squareForFenIndex(index);
    const probability = 1 / (1 + Math.exp(-(density - occupancyThreshold) / scale));
    occupancy[square] = Math.round(probability * 1000) / 1000;
    edgeDensity[square] = Math.round(density * 10000) / 10000;
    if (density >= occupancyThreshold) occupiedSquares.push(square);
  });

  return {
    method: "non-diagonal-gradient-v1",
    occupancy,
    edgeDensity,
    occupiedSquares,
    occupancyThreshold,
  };
}

function orientedVision(vision: BoardVision | undefined, orientation: Orientation): Record<string, number> {
  if (!vision) return {};
  if (orientation === "white") return vision.occupancy;
  return Object.fromEntries(
    Object.entries(vision.occupancy).map(([square, probability]) => [rotateSquare180(square), probability]),
  );
}

export function occupancyAgreementForPlacement(
  placement: string,
  vision: BoardVision | undefined,
  orientation: Orientation,
) {
  const cells = expandPlacement(placement);
  if (!vision || cells.length !== 64) return { agreement: 0.5, mismatches: [] as string[] };
  const occupancy = orientedVision(vision, orientation);
  let agreement = 0;
  const mismatches: string[] = [];

  cells.forEach((piece, index) => {
    const square = squareForFenIndex(index);
    const probability = occupancy[square] ?? 0.5;
    const occupied = piece !== ".";
    agreement += occupied ? probability : 1 - probability;
    if ((!occupied && probability >= 0.68) || (occupied && probability <= 0.25)) {
      mismatches.push(square);
    }
  });

  return { agreement: agreement / 64, mismatches };
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
    const visionPromise = analyzeBitmapOccupancy(bitmap, variant);
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
    const vision = await visionPromise;
    const occupancy = occupancyAgreementForPlacement(resolved.placement, vision, resolved.orientation);

    return {
      placement: resolved.placement,
      rawPlacement: scan.placement,
      orientation: resolved.orientation,
      meanConfidence: scan.meanConfidence,
      minConfidence: scan.minConfidence,
      reliable: scan.reliable && occupancy.mismatches.length <= 6,
      plausible,
      validPlacement: sanity.valid,
      placementQuality: sanity.score,
      qualityReasons: sanity.reasons,
      squareConfidence: selectedConfidence,
      confidenceCandidates: { whiteBottom: whiteConfidence, blackBottom: blackConfidence },
      uncertainSquares: [...new Set([...uncertainSquares, ...occupancy.mismatches])].sort(
        (a, b) => (8 - Number(a[1])) - (8 - Number(b[1])) || a.localeCompare(b),
      ),
      whiteBottom,
      blackBottom,
      corners,
      variant,
      ensembleScore: 0,
      vision,
      occupancyAgreement: occupancy.agreement,
      visionMismatchSquares: occupancy.mismatches,
    };
  } finally {
    bitmap.close();
  }
}

function fuseRecognitions(
  results: BrowserRecognition[],
  vision: BoardVision | undefined,
): BrowserRecognition | null {
  if (results.length < 2) return null;

  const votes = Array.from({ length: 64 }, () => new Map<string, number>());
  const confidenceVotes = Array.from({ length: 64 }, () => new Map<string, number[]>());
  const orientationWeight = { white: 0, black: 0 };

  for (const result of results) {
    const cells = expandPlacement(result.placement);
    if (cells.length !== 64) continue;
    const resultWeight = Math.max(0.25, 1 + result.placementQuality * 0.07);
    orientationWeight[result.orientation] += Math.max(
      0.2,
      result.meanConfidence + (result.validPlacement ? 0.35 : 0) + (result.occupancyAgreement ?? 0.5) * 0.35,
    );
    const occupancy = orientedVision(vision, result.orientation);

    cells.forEach((piece, index) => {
      const square = squareForFenIndex(index);
      const confidence = result.squareConfidence[square] ?? 0.5;
      const occupiedProbability = occupancy[square] ?? 0.5;
      let visionWeight = 1;
      if (piece === "." && occupiedProbability >= 0.68) visionWeight = 0.04;
      else if (piece !== "." && occupiedProbability >= 0.68) visionWeight = 1.75;
      else if (piece !== "." && occupiedProbability <= 0.25) visionWeight = 0.1;
      else if (piece === "." && occupiedProbability <= 0.25) visionWeight = 1.3;

      votes[index].set(
        piece,
        (votes[index].get(piece) ?? 0) + Math.max(0.05, confidence) * resultWeight * visionWeight,
      );
      const list = confidenceVotes[index].get(piece) ?? [];
      list.push(confidence);
      confidenceVotes[index].set(piece, list);
    });
  }

  const orientation: Orientation = orientationWeight.black > orientationWeight.white ? "black" : "white";
  const canonicalOccupancy = orientedVision(vision, orientation);
  const cells: string[] = [];
  const squareConfidence: Record<string, number> = {};
  const uncertainSquares: string[] = [];
  let minConfidence = 1;

  votes.forEach((cellVotes, index) => {
    const square = squareForFenIndex(index);
    const occupiedProbability = canonicalOccupancy[square] ?? 0.5;
    let sorted = [...cellVotes.entries()].sort((a, b) => b[1] - a[1]);

    // Vision is only an occupancy prior; it never invents a piece type. But on
    // a clearly occupied printed square it can stop four "empty" votes from
    // drowning out a real piece seen by one preprocessing/model candidate.
    if (occupiedProbability >= 0.68 && sorted.some(([piece]) => piece !== ".")) {
      sorted = sorted.filter(([piece]) => piece !== ".");
    } else if (occupiedProbability <= 0.25 && sorted.some(([piece]) => piece === ".")) {
      sorted = sorted.filter(([piece]) => piece === ".");
    }

    const [piece, winningWeight] = sorted[0] ?? [".", 0];
    const totalWeight = [...cellVotes.values()].reduce((sum, weight) => sum + weight, 0) || 1;
    const agreement = winningWeight / totalWeight;
    const confidences = confidenceVotes[index].get(piece) ?? [0.5];
    const meanModelConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const visionSupport = piece === "." ? 1 - occupiedProbability : occupiedProbability;
    const confidence = Math.min(1, meanModelConfidence * 0.62 + agreement * 0.23 + visionSupport * 0.15);

    cells.push(piece);
    squareConfidence[square] = confidence;
    minConfidence = Math.min(minConfidence, confidence);
    if (
      confidence < 0.7
      || agreement < 0.5
      || (piece === "." && occupiedProbability >= 0.68)
      || (piece !== "." && occupiedProbability <= 0.25)
    ) {
      uncertainSquares.push(square);
    }
  });

  const placement = compressPlacement(cells);
  const sanity = placementSanity(placement);
  const meanConfidence = Object.values(squareConfidence).reduce((a, b) => a + b, 0) / 64;
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
  const occupancy = occupancyAgreementForPlacement(placement, vision, orientation);

  const representative = [...results].sort((a, b) => b.meanConfidence - a.meanConfidence)[0];
  return {
    ...representative,
    placement,
    rawPlacement: placement,
    orientation,
    meanConfidence,
    minConfidence,
    reliable: uncertainSquares.length <= 8 && occupancy.mismatches.length <= 4,
    plausible: sanity.valid,
    validPlacement: sanity.valid,
    placementQuality: sanity.score,
    qualityReasons: sanity.reasons,
    squareConfidence,
    confidenceCandidates,
    uncertainSquares: [...new Set([...uncertainSquares, ...occupancy.mismatches])].sort(
      (a, b) => (8 - Number(a[1])) - (8 - Number(b[1])) || a.localeCompare(b),
    ),
    whiteBottom,
    blackBottom,
    variant: "ensemble",
    ensembleScore: 0,
    vision,
    occupancyAgreement: occupancy.agreement,
    visionMismatchSquares: occupancy.mismatches,
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
  const vision =
    results.find((result) => result.variant === "grid")?.vision
    ?? results.find((result) => result.variant === "original")?.vision
    ?? results[0].vision;
  const fused = fuseRecognitions(results, vision);
  if (fused) results.push(fused);

  const scored = results.map((result) => {
    const otherResults = results.filter((item) => item !== result && item.variant !== "ensemble");
    const consensus = otherResults.length
      ? otherResults.reduce((sum, item) => sum + placementAgreement(result.placement, item.placement), 0) / otherResults.length
      : 0;
    const occupancy = occupancyAgreementForPlacement(result.placement, vision, result.orientation);

    const score =
      result.meanConfidence +
      result.minConfidence * 0.12 +
      result.placementQuality * 0.22 +
      (result.validPlacement ? 0.72 : -0.72) +
      (result.plausible ? 0.1 : 0) +
      (result.reliable ? 0.06 : 0) +
      consensus * 0.2 +
      occupancy.agreement * 1.35 -
      Math.min(0.85, occupancy.mismatches.length * 0.045) -
      Math.min(0.25, result.uncertainSquares.length / 64 * 0.25) +
      (result.variant === "ensemble" ? 0.08 : 0);

    return {
      ...result,
      vision,
      occupancyAgreement: occupancy.agreement,
      visionMismatchSquares: occupancy.mismatches,
      ensembleScore: score,
    };
  });

  // Legality is heavily rewarded above, but it is no longer an absolute tier.
  // A board containing only two kings is technically legal yet obviously wrong
  // when the source image visibly contains twenty pieces. The independent
  // occupancy prior is allowed to overrule that failure mode.
  scored.sort((a, b) => b.ensembleScore - a.ensembleScore);
  return scored[0];
}
