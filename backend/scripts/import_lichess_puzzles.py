"""Stream a Lichess CSV / CSV.zst into indexed SQLite without loading it in RAM.
Run from backend: python scripts/import_lichess_puzzles.py path/to/file.csv.zst
"""
from contextlib import closing
import argparse
import csv
import io
import os
from pathlib import Path
import re
import sqlite3
import tempfile


def import_database(source: Path, output: Path, limit: int = 0):
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix="puzzles-import-", suffix=".sqlite3", dir=output.parent)
    os.close(fd)
    count = skipped = 0
    try:
        with source.open("rb") as raw:
            if source.suffix.lower() == ".zst":
                import zstandard
                stream = zstandard.ZstdDecompressor().stream_reader(raw)
            else:
                stream = raw
            with io.TextIOWrapper(stream, encoding="utf-8-sig", newline="") as text, closing(sqlite3.connect(temp)) as db:
                rows = csv.DictReader(text)
                if not {"PuzzleId", "FEN", "Moves", "Rating", "Themes"}.issubset(rows.fieldnames or []):
                    raise ValueError("Không đúng CSV puzzle Lichess: thiếu cột bắt buộc.")
                db.executescript("""
                  CREATE TABLE puzzles (id TEXT PRIMARY KEY, fen TEXT NOT NULL, moves TEXT NOT NULL, rating INTEGER NOT NULL, themes TEXT NOT NULL);
                  CREATE TABLE themes (theme TEXT NOT NULL, rating INTEGER NOT NULL, id TEXT NOT NULL, PRIMARY KEY(theme,id));
                  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                """)
                for row in rows:
                    try:
                        rating = int(row["Rating"])
                        moves = row["Moves"].split()
                        if not row["PuzzleId"] or len(row["FEN"].split()) != 6 or not 0 <= rating <= 4000 or len(moves) < 2 or not all(re.fullmatch(r"[a-h][1-8][a-h][1-8][qrbn]?", move) for move in moves):
                            raise ValueError()
                    except (ValueError, TypeError, AttributeError):
                        skipped += 1
                        continue
                    added = db.execute("INSERT OR IGNORE INTO puzzles VALUES (?,?,?,?,?)", (row["PuzzleId"], row["FEN"], row["Moves"], rating, row["Themes"])).rowcount
                    if not added:
                        continue
                    db.executemany("INSERT OR IGNORE INTO themes VALUES (?,?,?)", ((tag, rating, row["PuzzleId"]) for tag in row["Themes"].split()))
                    count += 1
                    if count % 10000 == 0:
                        db.commit()
                        print(f"Đã nhập {count:,} câu", flush=True)
                    if limit and count >= limit:
                        break
                if not count:
                    raise ValueError("Tệp không có câu đố hợp lệ; giữ nguyên database cũ.")
                db.executescript("CREATE INDEX puzzle_rating ON puzzles(rating,id); CREATE INDEX theme_rating ON themes(theme,rating,id);")
                db.execute("INSERT INTO metadata VALUES ('count',?)", (str(count),))
                db.commit()
            # closing() releases SQLite before replacing the file on Windows.
        os.replace(temp, output)
        print(f"Hoàn tất: {count:,} câu, bỏ qua {skipped:,} dòng lỗi. {output}")
        return count
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--limit", type=int, default=0, help="0 = toàn bộ database")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent.parent / "data" / "lichess-puzzles.sqlite3")
    args = parser.parse_args()
    if args.limit < 0:
        parser.error("--limit phải >= 0")
    import_database(args.source, args.output, args.limit)
