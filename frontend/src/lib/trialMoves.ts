import { Chess } from "chess.js";

export function promotionRequired(fen: string, from: string, to: string): boolean {
  return new Chess(fen).moves({ verbose: true }).some(
    (move) => move.from === from && move.to === to && Boolean(move.promotion),
  );
}

export function moveFen(fen: string, from: string, to: string, promotion?: string): string {
  const game = new Chess(fen);
  game.move({ from, to, promotion });
  return game.fen();
}
