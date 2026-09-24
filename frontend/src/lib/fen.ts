export const PIECE_TO_UNICODE: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

const PIECES = new Set(Object.keys(PIECE_TO_UNICODE));

export function expandPlacement(placement: string): string[] {
  const ranks = placement.trim().split("/");
  if (ranks.length !== 8) throw new Error("FEN phải có 8 hàng.");

  const cells: string[] = [];
  for (const rank of ranks) {
    let count = 0;
    for (const ch of rank) {
      if (PIECES.has(ch)) {
        cells.push(ch);
        count += 1;
      } else if (/^[1-8]$/.test(ch)) {
        const n = Number(ch);
        for (let i = 0; i < n; i += 1) cells.push(".");
        count += n;
      } else {
        throw new Error(`Ký tự FEN không hợp lệ: ${ch}`);
      }
    }
    if (count !== 8) throw new Error("Mỗi hàng FEN phải có đúng 8 ô.");
  }
  return cells;
}

export function compressPlacement(cells: string[]): string {
  if (cells.length !== 64) throw new Error("Bàn cờ phải có đúng 64 ô.");

  const ranks: string[] = [];
  for (let row = 0; row < 8; row += 1) {
    let rank = "";
    let empty = 0;
    for (let col = 0; col < 8; col += 1) {
      const piece = cells[row * 8 + col];
      if (piece === ".") {
        empty += 1;
      } else {
        if (empty) {
          rank += String(empty);
          empty = 0;
        }
        rank += piece;
      }
    }
    if (empty) rank += String(empty);
    ranks.push(rank);
  }
  return ranks.join("/");
}

export function squareToIndex(square: string): number {
  if (!/^[a-h][1-8]$/.test(square)) throw new Error("Ô cờ không hợp lệ.");
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const row = 8 - rank;
  return row * 8 + file;
}

export function getPieceAt(placement: string, square: string): string | null {
  const piece = expandPlacement(placement)[squareToIndex(square)];
  return piece === "." ? null : piece;
}

export function setPieceAt(
  placement: string,
  square: string,
  piece: string | null,
): string {
  const cells = expandPlacement(placement);
  cells[squareToIndex(square)] = piece ?? ".";
  return compressPlacement(cells);
}

export function movePiece(
  placement: string,
  source: string,
  target: string,
): string {
  const cells = expandPlacement(placement);
  const from = squareToIndex(source);
  const to = squareToIndex(target);
  const piece = cells[from];
  if (piece === ".") return placement;
  cells[from] = ".";
  cells[to] = piece;
  return compressPlacement(cells);
}

export function clearPlacement(): string {
  return "8/8/8/8/8/8/8/8";
}

export function buildFen(
  placement: string,
  sideToMove: "w" | "b",
  castling: string,
  enPassant: string,
): string {
  const cleanCastling = castling && castling !== "-" ? castling : "-";
  const cleanEp = enPassant.trim() || "-";
  return `${placement} ${sideToMove} ${cleanCastling} ${cleanEp} 0 1`;
}

export function parseFen(fen: string) {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 1) throw new Error("FEN trống.");
  expandPlacement(parts[0]);

  const side = parts[1] === "b" ? "b" : "w";
  const castling = parts[2] && parts[2] !== "-" ? parts[2] : "-";
  const enPassant = parts[3] ?? "-";

  return {
    placement: parts[0],
    sideToMove: side as "w" | "b",
    castling,
    enPassant,
  };
}

export function lichessAnalysisUrl(fen: string): string {
  return `https://lichess.org/analysis/standard/${fen.trim().replace(/\s+/g, "_")}`;
}
