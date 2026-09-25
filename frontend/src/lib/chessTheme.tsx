import type { CSSProperties } from "react";
import type { PieceRenderObject } from "react-chessboard";

export const BOARD_THEME = {
  light: "#eeeed2",
  dark: "#769656",
  frame: "#38452d",
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

const pieceImageStyle: CSSProperties = {
  // react-chessboard renders a second "clone" while dragging. That clone
  // lives in a portal and does not inherit the square's dimensions, so an
  // unconstrained 100% image can grow to the size of the viewport.
  // min(100%, 96px) keeps normal pieces square-sized while capping the
  // drag overlay to a human-sized chess piece.
  width: "min(100%, 96px)",
  height: "min(100%, 96px)",
  maxWidth: "96px",
  maxHeight: "96px",
  margin: "auto",
  objectFit: "contain",
  display: "block",
  pointerEvents: "none",
  userSelect: "none",
};

export const BOARD_PIECES: PieceRenderObject = Object.fromEntries(
  Object.entries(PIECE_ASSETS).map(([pieceType, src]) => [
    pieceType,
    (props?: { svgStyle?: CSSProperties }) => (
      <img
        src={src}
        alt={pieceType}
        draggable={false}
        style={{ ...pieceImageStyle, ...(props?.svgStyle ?? {}) }}
      />
    ),
  ]),
) as PieceRenderObject;
