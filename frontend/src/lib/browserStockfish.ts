import { Chess } from "chess.js";

export type LocalEngineLine = {
  evaluation: number;
  mate: number | null;
  depth: number;
  san: string;
  uci: string;
  multipv: number;
};

function pvToSan(fen: string, pv: string[]): string {
  const game = new Chess(fen);
  const san: string[] = [];

  for (const uci of pv.slice(0, 10)) {
    if (uci.length < 4) break;
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;

    try {
      const move = game.move({ from, to, promotion });
      if (!move) break;
      san.push(move.san);
    } catch {
      break;
    }
  }

  return san.join(" ");
}

export async function analyzeWithBrowserStockfish(
  fen: string,
  depth = 16,
  multipv = 3,
): Promise<LocalEngineLine[]> {
  if (typeof Worker === "undefined") {
    throw new Error("Trình duyệt này không hỗ trợ Web Worker.");
  }

  return await new Promise((resolve, reject) => {
    const worker = new Worker("/stockfish/stockfish-19-lite-single.js");
    const latest = new Map<number, LocalEngineLine>();
    let ready = false;
    let settled = false;

    const cleanup = () => {
      worker.terminate();
    };

    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Stockfish local chạy quá lâu. Hãy thử depth thấp hơn."));
    }, 45000);

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cleanup();
      reject(error);
    };

    worker.onerror = () => fail(new Error("Không khởi động được Stockfish local."));

    worker.onmessage = (event) => {
      const line = String(event.data ?? "");

      if (line === "uciok") {
        worker.postMessage(`setoption name MultiPV value ${Math.max(1, Math.min(multipv, 5))}`);
        worker.postMessage("isready");
        return;
      }

      if (line === "readyok" && !ready) {
        ready = true;
        worker.postMessage(`position fen ${fen}`);
        worker.postMessage(`go depth ${Math.max(8, Math.min(depth, 22))}`);
        return;
      }

      if (line.startsWith("info ") && line.includes(" pv ")) {
        const depthMatch = line.match(/\bdepth\s+(\d+)/);
        const multipvMatch = line.match(/\bmultipv\s+(\d+)/);
        const scoreCpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
        const scoreMateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
        const pvMatch = line.match(/\bpv\s+(.+)$/);

        if (!pvMatch) return;

        const pv = pvMatch[1].trim().split(/\s+/);
        const pvIndex = Number(multipvMatch?.[1] ?? 1);
        const cp = scoreCpMatch ? Number(scoreCpMatch[1]) : 0;
        const mate = scoreMateMatch ? Number(scoreMateMatch[1]) : null;

        latest.set(pvIndex, {
          evaluation: cp / 100,
          mate,
          depth: Number(depthMatch?.[1] ?? 0),
          san: pvToSan(fen, pv),
          uci: pv.join(" "),
          multipv: pvIndex,
        });
        return;
      }

      if (line.startsWith("bestmove")) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        cleanup();

        const result = Array.from(latest.values())
          .sort((a, b) => a.multipv - b.multipv)
          .slice(0, multipv);

        resolve(result);
      }
    };

    worker.postMessage("uci");
  });
}
