import { Chess } from "chess.js";
export type Puzzle = { id: string; fen: string; moves: string; rating: number; themes: string };
export function playUci(game: Chess, uci: string) {
  return game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}
export function startPuzzle(puzzle: Puzzle) {
  const game = new Chess(puzzle.fen);
  playUci(game, puzzle.moves.split(/\s+/)[0]);
  return game;
}
export function attemptPuzzle(puzzle: Puzzle, fen: string, ply: number, uci: string) {
  const game = new Chess(fen);
  try { playUci(game, uci); } catch { return null; }
  const moves = puzzle.moves.split(/\s+/);
  // Lichess permits any immediate checkmate, including alternate mate-in-one moves.
  if (uci !== moves[ply] && !game.isCheckmate()) return null;
  let next = ply + 1;
  if (!game.isCheckmate() && next < moves.length) { playUci(game, moves[next]); next++; }
  return { fen: game.fen(), ply: next, done: game.isCheckmate() || next >= moves.length };
}
