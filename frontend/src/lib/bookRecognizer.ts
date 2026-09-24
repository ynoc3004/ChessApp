type Orientation = "white" | "black";

export type BrowserRecognition = {
  placement: string;
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
): Promise<BrowserRecognition | null> {
  const loaded = await getRecognizer();
  const response = await fetch(imageUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Không tải được ảnh bàn cờ để AI nhận dạng.");
  }

  const blob = await response.blob();
  const scan = await loaded.recognizer.recognize(blob);
  if (!scan) return null;

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
    .sort((a, b) => (8 - Number(a[1])) - (8 - Number(b[1])) || a.localeCompare(b));

  return {
    placement: resolved.placement,
    orientation: resolved.orientation,
    meanConfidence: scan.meanConfidence,
    minConfidence: scan.minConfidence,
    reliable: scan.reliable,
    plausible: scan.plausible,
    squareConfidence: selectedConfidence,
    confidenceCandidates: {
      whiteBottom: whiteConfidence,
      blackBottom: blackConfidence,
    },
    uncertainSquares,
    whiteBottom,
    blackBottom,
  };
}
