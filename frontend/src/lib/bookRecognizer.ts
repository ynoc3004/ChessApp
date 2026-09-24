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

    const plausible =
      (scan as unknown as { plausible?: boolean }).plausible ?? true;
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

    const selectedConfidence =
      resolved.orientation === "black" ? blackConfidence : whiteConfidence;
    const uncertainSquares = Object.entries(selectedConfidence)
      .filter(([, confidence]) => confidence < 0.7)
      .map(([square]) => square)
      .sort(
        (a, b) =>
          (8 - Number(a[1])) - (8 - Number(b[1])) || a.localeCompare(b),
      );

    const corners = {
      x0: scan.corners.x0 / detectScale,
      y0: scan.corners.y0 / detectScale,
      x1: scan.corners.x1 / detectScale,
      y1: scan.corners.y1 / detectScale,
    };

    return {
      placement: resolved.placement,
      rawPlacement: scan.placement,
      orientation: resolved.orientation,
      meanConfidence: scan.meanConfidence,
      minConfidence: scan.minConfidence,
      reliable: scan.reliable,
      plausible,
      squareConfidence: selectedConfidence,
      confidenceCandidates: {
        whiteBottom: whiteConfidence,
        blackBottom: blackConfidence,
      },
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

  const scored = results.map((result) => {
    const otherResults = results.filter((item) => item !== result);
    const consensus = otherResults.length
      ? otherResults.reduce(
          (sum, item) =>
            sum + placementAgreement(result.rawPlacement, item.rawPlacement),
          0,
        ) / otherResults.length
      : 0;

    const score =
      result.meanConfidence +
      result.minConfidence * 0.18 +
      (result.plausible ? 0.22 : 0) +
      (result.reliable ? 0.1 : 0) +
      consensus * 0.28;

    return {
      ...result,
      ensembleScore: score,
    };
  });

  scored.sort((a, b) => b.ensembleScore - a.ensembleScore);
  return scored[0];
}
