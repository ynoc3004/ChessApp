"""Download the latest Lichess puzzle export and replace the local index safely.

Run from backend: python scripts/update_lichess_puzzles.py
"""
import argparse
import json
import os
from pathlib import Path
import tempfile
from urllib.request import Request, urlopen

try:
    from .import_lichess_puzzles import import_database
except ImportError:  # Direct execution: python scripts/update_lichess_puzzles.py
    from import_lichess_puzzles import import_database


URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"
OUTPUT = Path(__file__).resolve().parent.parent / "data" / "lichess-puzzles.sqlite3"
CHUNK = 1024 * 1024


def update_database(output=OUTPUT, *, limit=0, force=False, check=False, opener=urlopen):
    output = Path(output)
    state_path = output.with_name("lichess-puzzles-source.json")
    with opener(Request(URL, method="HEAD"), timeout=60) as response:
        headers = response.headers
        signature = {key: headers.get(key) for key in ("ETag", "Last-Modified", "Content-Length")}
    # A size alone is not a reliable version identifier.
    has_version = bool(signature["ETag"] or signature["Last-Modified"])
    try:
        previous = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        previous = {}
    current = output.exists() and has_version and previous.get("url") == URL and previous.get("signature") == signature
    if check:
        print("Kho câu đố đã mới nhất." if current else "Có bản mới hoặc chưa nhập kho câu đố.")
        return not current
    if current and not (force or limit):
        print("Kho câu đố đã mới nhất; không cần tải lại.")
        return False

    output.parent.mkdir(parents=True, exist_ok=True)
    fd, archive = tempfile.mkstemp(prefix="lichess-download-", suffix=".csv.zst", dir=output.parent)
    os.close(fd)
    try:
        downloaded = 0
        print("Đang tải database câu đố từ Lichess…", flush=True)
        with opener(Request(URL, method="GET"), timeout=120) as response, open(archive, "wb") as target:
            while chunk := response.read(CHUNK):
                target.write(chunk)
                downloaded += len(chunk)
                if downloaded // (25 * CHUNK) != (downloaded - len(chunk)) // (25 * CHUNK):
                    print(f"Đã tải {downloaded // CHUNK:,} MiB", flush=True)
        if not downloaded or (signature["Content-Length"] and downloaded != int(signature["Content-Length"])):
            raise ValueError("Tệp tải chưa đầy đủ; kho cũ được giữ nguyên.")
        import_database(Path(archive), output, limit)
        if not limit:
            fd, state_temp = tempfile.mkstemp(prefix="lichess-state-", suffix=".json", dir=output.parent)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as target:
                    json.dump({"url": URL, "signature": signature}, target, ensure_ascii=False)
                os.replace(state_temp, state_path)
            finally:
                if os.path.exists(state_temp):
                    os.unlink(state_temp)
        print("Lần sau chạy lại lệnh này để kiểm tra bản Lichess mới.")
        return True
    finally:
        if os.path.exists(archive):
            os.unlink(archive)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Chỉ kiểm tra, không tải")
    parser.add_argument("--force", action="store_true", help="Tải lại cả khi phiên bản không đổi")
    parser.add_argument("--limit", type=int, default=0, help="Nhập thử N câu; 0 = toàn bộ")
    args = parser.parse_args()
    if args.limit < 0:
        parser.error("--limit phải >= 0")
    update_database(limit=args.limit, force=args.force, check=args.check)
