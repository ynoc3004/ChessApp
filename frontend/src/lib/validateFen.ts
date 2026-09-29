import { Chess } from "chess.js";

export type FenValidation = { valid: true; reason: "" } | { valid: false; reason: string };

const invalid = (reason: string): FenValidation => ({ valid: false, reason });
const at = (cells: string[], row: number, file: number) =>
  row >= 0 && row < 8 && file >= 0 && file < 8 ? cells[row * 8 + file] : ".";

function attacked(cells: string[], target: number, byWhite: boolean): boolean {
  const row = Math.floor(target / 8);
  const file = target % 8;
  const pawn = byWhite ? "P" : "p";
  for (const delta of [-1, 1]) {
    if (at(cells, row + (byWhite ? 1 : -1), file + delta) === pawn) return true;
  }
  const knight = byWhite ? "N" : "n";
  for (const [dr, df] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
    if (at(cells, row + dr, file + df) === knight) return true;
  }
  const king = byWhite ? "K" : "k";
  const rook = byWhite ? "R" : "r";
  const bishop = byWhite ? "B" : "b";
  const queen = byWhite ? "Q" : "q";
  for (const [dr, df] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
    if (at(cells, row + dr, file + df) === king) return true;
    for (let step = 1; step < 8; step += 1) {
      const piece = at(cells, row + dr * step, file + df * step);
      if (piece === ".") {
        if (row + dr * step < 0 || row + dr * step > 7 || file + df * step < 0 || file + df * step > 7) break;
        continue;
      }
      if (piece === queen || (dr === 0 || df === 0 ? piece === rook : piece === bishop)) return true;
      break;
    }
  }
  return false;
}

export function validateFen(fen: string): FenValidation {
  const parts = fen.trim().split(/\s+/);
  if (parts.length !== 6) return invalid("FEN phải có đủ 6 trường.");
  try {
    new Chess(fen);
  } catch {
    return invalid("Cú pháp FEN không hợp lệ.");
  }
  const cells: string[] = [];
  for (const rank of parts[0].split("/")) {
    for (const char of rank) {
      if (/^[1-8]$/.test(char)) cells.push(...Array(Number(char)).fill("."));
      else cells.push(char);
    }
  }
  const count = (piece: string) => cells.filter((item) => item === piece).length;
  if (count("K") !== 1 || count("k") !== 1) return invalid("Phải có đúng một vua mỗi bên.");
  if (count("P") > 8 || count("p") > 8) return invalid("Mỗi bên có tối đa 8 tốt.");
  if (cells.filter((p) => /[A-Z]/.test(p)).length > 16 || cells.filter((p) => /[a-z]/.test(p)).length > 16) {
    return invalid("Mỗi bên có tối đa 16 quân.");
  }
  if ([...cells.slice(0, 8), ...cells.slice(56)].some((p) => p === "P" || p === "p")) {
    return invalid("Tốt không được ở hàng 1 hoặc 8.");
  }
  const whiteKing = cells.indexOf("K");
  const blackKing = cells.indexOf("k");
  if (Math.abs(Math.floor(whiteKing / 8) - Math.floor(blackKing / 8)) <= 1 && Math.abs(whiteKing % 8 - blackKing % 8) <= 1) {
    return invalid("Hai vua không được đứng kề nhau.");
  }
  const castling = parts[2];
  for (const [right, kingSquare, rookSquare, king, rook] of [
    ["K", 60, 63, "K", "R"], ["Q", 60, 56, "K", "R"],
    ["k", 4, 7, "k", "r"], ["q", 4, 0, "k", "r"],
  ] as const) {
    if (castling.includes(right) && (cells[kingSquare] !== king || cells[rookSquare] !== rook)) {
      return invalid(`Quyền nhập thành ${right} không khớp vị trí vua và xe.`);
    }
  }
  if (attacked(cells, parts[1] === "w" ? blackKing : whiteKing, parts[1] === "w")) {
    return invalid("Vua của bên không đi đang bị chiếu.");
  }
  return { valid: true, reason: "" };
}
