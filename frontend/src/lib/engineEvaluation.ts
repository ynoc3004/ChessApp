import type { LocalEngineLine } from "./browserStockfish";

export type WhiteScore = { score: number; mate: number | null };

export function scoreForWhite(line: LocalEngineLine, fen: string): WhiteScore {
  const sign = fen.split(/\s+/)[1] === "b" ? -1 : 1;
  return {
    score: sign * line.evaluation,
    mate: line.mate === null ? null : sign * line.mate,
  };
}

export function scoreLabel(value: WhiteScore) {
  if (value.mate !== null) return value.mate > 0 ? `M+${value.mate}` : `M${value.mate}`;
  return `${value.score >= 0 ? "+" : ""}${value.score.toFixed(2)}`;
}

export function verdict(value: WhiteScore) {
  if (value.mate !== null) {
    if (value.mate === 0) return "Thế cờ đã kết thúc";
    return value.mate > 0 ? "Trắng có đường chiếu hết" : "Đen có đường chiếu hết";
  }
  if (Math.abs(value.score) < 0.35) return "Thế cờ cân bằng";
  const side = value.score > 0 ? "Trắng" : "Đen";
  if (Math.abs(value.score) < 1) return `${side} nhỉnh hơn`;
  return `${side} có ưu thế`;
}

export function shareForWhite(value: WhiteScore) {
  if (value.mate !== null) return value.mate > 0 ? 98 : value.mate < 0 ? 2 : 50;
  return Math.max(3, Math.min(97, 50 + 47 * Math.tanh(value.score / 4)));
}
