import type { LocalEngineLine } from "@/lib/browserStockfish";
import { scoreForWhite, scoreLabel, shareForWhite, verdict } from "@/lib/engineEvaluation";
import styles from "./EngineAdvantage.module.css";

export default function EngineAdvantage({ lines, fen }: { lines: LocalEngineLine[]; fen: string }) {
  if (!lines.length) return null;
  const main = scoreForWhite(lines[0], fen);
  const share = shareForWhite(main);

  return (
    <section className={styles.card} aria-label="Đánh giá Stockfish">
      <div className={styles.heading}>
        <div>
          <span className={styles.kicker}>STOCKFISH · ĐÁNH GIÁ VỊ TRÍ</span>
          <h3>{verdict(main)}</h3>
        </div>
        <strong className={styles.score}>{scoreLabel(main)}</strong>
      </div>
      <div className={styles.meterLabels}><span>♔ Trắng</span><span>Đen ♚</span></div>
      <div className={styles.meter} role="meter" aria-label="Thang ưu thế từ Đen sang Trắng" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share)} aria-valuetext={`${verdict(main)}, điểm ${scoreLabel(main)} theo Trắng`}>
        <span className={styles.whiteShare} style={{ width: `${share}%` }} />
        <span className={styles.midpoint} aria-hidden="true" />
      </div>
      <p className={styles.caption}>Điểm theo góc nhìn Trắng · độ sâu {lines[0].depth}. Thanh chỉ minh họa mức ưu thế, không phải xác suất thắng.</p>
      <div className={styles.variations} aria-label="Các phương án Stockfish">
        {lines.map((line, index) => (
          <div className={styles.variation} key={line.multipv}>
            <span className={styles.rank}>#{index + 1}</span>
            <strong>{scoreLabel(scoreForWhite(line, fen))}</strong>
            <span className={styles.moves}>{line.san || "Chưa có nước đi"}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
