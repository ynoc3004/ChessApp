export const BOARD_THEME = {
  // Correct chessboard parity: a8 is light and a1 is dark.
  // These colors also stay close to the green/cream diagrams in many books.
  light: "#f4edd8",
  dark: "#93ad6d",
  frame: "#8b9d73",
} as const;

const PIECE_ASSETS: Record<string, string> = {
  wK: "/pieces/cburnett/wK.svg",
  wQ: "/pieces/cburnett/wQ.svg",
  wR: "/pieces/cburnett/wR.svg",
  wB: "/pieces/cburnett/wB.svg",
  wN: "/pieces/cburnett/wN.svg",
  wP: "/pieces/cburnett/wP.svg",
  bK: "/pieces/cburnett/bK.svg",
  bQ: "/pieces/cburnett/bQ.svg",
  bR: "/pieces/cburnett/bR.svg",
  bB: "/pieces/cburnett/bB.svg",
  bN: "/pieces/cburnett/bN.svg",
  bP: "/pieces/cburnett/bP.svg",
};

export const PIECE_ASSET_BY_FEN: Record<string, string> = {
  K: PIECE_ASSETS.wK,
  Q: PIECE_ASSETS.wQ,
  R: PIECE_ASSETS.wR,
  B: PIECE_ASSETS.wB,
  N: PIECE_ASSETS.wN,
  P: PIECE_ASSETS.wP,
  k: PIECE_ASSETS.bK,
  q: PIECE_ASSETS.bQ,
  r: PIECE_ASSETS.bR,
  b: PIECE_ASSETS.bB,
  n: PIECE_ASSETS.bN,
  p: PIECE_ASSETS.bP,
};

export const PIECE_LABEL_BY_FEN: Record<string, string> = {
  K: "Vua trắng",
  Q: "Hậu trắng",
  R: "Xe trắng",
  B: "Tượng trắng",
  N: "Mã trắng",
  P: "Tốt trắng",
  k: "Vua đen",
  q: "Hậu đen",
  r: "Xe đen",
  b: "Tượng đen",
  n: "Mã đen",
  p: "Tốt đen",
};
