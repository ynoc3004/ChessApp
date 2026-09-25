"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DaoAmbient from "@/components/DaoAmbient";
import {
  API_BASE,
  type BookListResponse,
  type BookSummary,
  type Position,
  type ScanJob,
  type UploadResponse,
} from "@/lib/api";

function cultivationStage(progress: number) {
  if (progress < 20) return { name: "Khai Phổ", mark: "壹", note: "Mở kinh quyển, định vị kỳ đồ" };
  if (progress < 50) return { name: "Quan Trận", mark: "貳", note: "Dò tìm thế cờ trong cổ phổ" };
  if (progress < 80) return { name: "Ngộ Cục", mark: "參", note: "Tách trận đồ, hội tụ kỳ thế" };
  if (progress < 100) return { name: "Khắc Ấn", mark: "肆", note: "Hoàn thiện dữ liệu và nhập tàng" };
  return { name: "Viên Mãn", mark: "成", note: "Kỳ phổ đã nhập Tàng Kinh Các" };
}

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [jobId, setJobId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [recentBooks, setRecentBooks] = useState<BookSummary[]>([]);
  const [scanJob, setScanJob] = useState<ScanJob | null>(null);
  const [pageQuery, setPageQuery] = useState("");
  const [galleryPage, setGalleryPage] = useState(1);
  const PAGE_SIZE = 12;

  const filteredPositions = useMemo(() => {
    const query = pageQuery.trim();
    if (!query) return positions;
    const page = Number(query);
    if (!Number.isFinite(page)) return positions;
    return positions.filter((position) => position.page === page);
  }, [pageQuery, positions]);

  const totalGalleryPages = Math.max(
    1,
    Math.ceil(filteredPositions.length / PAGE_SIZE),
  );

  const scanCultivation = cultivationStage(scanJob?.progress ?? 0);

  const visiblePositions = filteredPositions.slice(
    (galleryPage - 1) * PAGE_SIZE,
    galleryPage * PAGE_SIZE,
  );

  function openBook(book: UploadResponse) {
    setJobId(book.jobId);
    setFilename(book.filename);
    setPositions(book.positions);
    setPageQuery("");
    setGalleryPage(1);
    window.localStorage.setItem("chessBookReader:lastJobId", book.jobId);
  }

  async function loadRecentBooks() {
    try {
      const response = await fetch(`${API_BASE}/api/books`);
      const data = (await response.json()) as BookListResponse;
      if (response.ok) setRecentBooks(data.books ?? []);
    } catch {
      // History is optional; uploads still work if this request fails.
    }
  }

  useEffect(() => {
    void loadRecentBooks();
    const savedJobId = window.localStorage.getItem("chessBookReader:lastJobId");
    if (!savedJobId) return;

    setRestoring(true);
    void fetch(`${API_BASE}/api/books/${savedJobId}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail ?? "Không khôi phục được lần quét trước");
        const result = data as UploadResponse;
        openBook(result);
      })
      .catch(() => {
        window.localStorage.removeItem("chessBookReader:lastJobId");
      })
      .finally(() => setRestoring(false));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError("");
    setPositions([]);
    setJobId("");
    setScanJob(null);

    const body = new FormData();
    body.append("file", file);

    try {
      const response = await fetch(`${API_BASE}/api/books/start`, {
        method: "POST",
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail ?? "Không bắt đầu quét được");

      let current = data as ScanJob;
      setScanJob(current);
      setJobId(current.jobId);
      setFilename(current.filename || file.name);

      while (current.status === "queued" || current.status === "processing") {
        await new Promise((resolve) => window.setTimeout(resolve, 750));

        const statusResponse = await fetch(
          `${API_BASE}/api/jobs/${current.jobId}`,
          { cache: "no-store" },
        );
        const statusData = await statusResponse.json();
        if (!statusResponse.ok) {
          if (statusResponse.status === 503) {
            // Backend is replacing status.json on Windows; retry on next poll.
            continue;
          }
          throw new Error(statusData.detail ?? "Không đọc được tiến trình quét");
        }

        current = statusData as ScanJob;
        setScanJob(current);
        setPositions(current.positions ?? []);

        if (current.status === "failed") {
          throw new Error(current.error || "Quét sách thất bại");
        }
      }

      const result: UploadResponse = {
        jobId: current.jobId,
        filename: current.filename || file.name,
        count: current.count,
        positions: current.positions ?? [],
      };
      openBook(result);
      await loadRecentBooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  async function deleteBook(book: BookSummary) {
    const confirmed = window.confirm(
      `Xóa dữ liệu đã quét của "${book.filename}" khỏi máy? Các diagram của job này cũng sẽ bị xóa.`,
    );
    if (!confirmed) return;

    try {
      const response = await fetch(`${API_BASE}/api/books/${book.jobId}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail ?? "Không xóa được");

      if (jobId === book.jobId) {
        setJobId("");
        setFilename("");
        setPositions([]);
        window.localStorage.removeItem("chessBookReader:lastJobId");
      }
      await loadRecentBooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xóa được");
    }
  }

  return (
    <main className={`shell ${positions.length > 0 ? "hasResults" : ""}`}>
      <DaoAmbient />
      <section className="hero daoHero">
        <div className="daoSeal" aria-hidden="true">☯</div>
        <div className="daoTrigrams" aria-hidden="true">
          <span>☰</span><span>☵</span><span>☶</span><span>☷</span>
        </div>
        <p className="eyebrow">KỲ PHỔ TÀNG KINH · HUYỀN MÔN KỲ ĐẠO</p>
        <h1>Khai cổ phổ giữa vân hải tiên sơn, tĩnh tâm diễn hóa kỳ cục.</h1>
        <p className="subtle">
          Nạp PDF hoặc DOCX vào Tàng Kinh Các. Hệ thống tự tìm kỳ đồ, AI đọc 64 ô và dựng FEN; sau đó bạn có thể bố trận, diễn hóa nước đi và vận dụng Tâm pháp Stockfish trong một tiên cảnh sáng, nhẹ và dễ quan sát.
        </p>
        <p className="daoQuote">“Tiên sơn vân hải · tĩnh tâm quan cục · nhất tử định càn khôn.”</p>
      </section>

      <form className="uploadCard" onSubmit={submit}>
        <label className="dropzone">
          <span className="dropTitle">Nạp kỳ phổ vào Tàng Kinh Các</span>
          <span className="subtle">PDF / DOCX được xử lý hoàn toàn trên backend local của bạn.</span>
          <input
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button className="primary" disabled={!file || loading}>
          {loading ? "Đang khai mở kỳ phổ…" : "Khai phổ · nhập Tàng Kinh"}
        </button>
        {file && <p className="subtle">Đã chọn: {file.name}</p>}
        {scanJob && loading && (
          <div className="scanProgress cultivationProgress">
            <div className="cultivationHeader">
              <div className="realmSeal" aria-hidden="true">{scanCultivation.mark}</div>
              <div>
                <span className="realmKicker">CẢNH GIỚI QUÉT PHỔ</span>
                <strong>{scanJob.status === "queued" ? "Tụ Khí" : scanCultivation.name}</strong>
                <small>{scanJob.status === "queued" ? "Đang chuẩn bị pháp trận xử lý" : scanCultivation.note}</small>
              </div>
              <span className="realmPercent">{scanJob.progress.toFixed(1)}%</span>
            </div>
            <div className="progressTrack" aria-label="Tiến trình quét">
              <div
                className="progressFill"
                style={{ width: `${Math.max(1, scanJob.progress)}%` }}
              />
            </div>
            <p className="subtle">
              {scanJob.total > 0
                ? `Đã xử lý ${scanJob.current} / ${scanJob.total}`
                : "Đang đọc thông tin tài liệu"}{" "}
              · đã lĩnh hội {scanJob.count} kỳ đồ.
            </p>
          </div>
        )}
        {restoring && <p className="subtle daoStatus">☁ Đang triệu hồi kỳ phổ gần nhất từ Tàng Kinh Các…</p>}
        {error && <p className="error">{error}</p>}
      </form>

      {recentBooks.length > 0 && (
        <details className="recentBooks recentBooksCompact">
          <summary>
            Tàng Kinh Các · sách đã quét ({recentBooks.length})
          </summary>
          <div className="recentBookList">
            {recentBooks.map((book) => (
              <article className="recentBookItem" key={book.jobId}>
                <div>
                  <strong>{book.filename}</strong>
                  <p className="subtle">{book.count} hình cờ</p>
                </div>
                <div className="actions">
                  <button className="button" onClick={() => openBook(book)}>
                    Nhập Các
                  </button>
                  <a className="button" href={`${API_BASE}/api/books/${book.jobId}/download`}>
                    Thu kinh ZIP
                  </a>
                  <a className="button" href={`${API_BASE}/api/books/${book.jobId}/recognized.json`}>
                    Kỳ văn FEN
                  </a>
                  <button className="button dangerButton" onClick={() => void deleteBook(book)}>
                    Xóa
                  </button>
                </div>
              </article>
            ))}
          </div>
        </details>
      )}

      {positions.length > 0 && (
        <section className="results">
          <div className="galleryToolbar">
            <div>
              <p className="eyebrow">KỲ PHỔ · {filename}</p>
              <h2>{positions.length} kỳ đồ đã khai mở</h2>
            </div>

            <div className="pageSearch">
              <label htmlFor="page-search">Truy tìm theo trang cổ phổ</label>
              <div>
                <input
                  id="page-search"
                  inputMode="numeric"
                  placeholder="VD: 126"
                  value={pageQuery}
                  onChange={(event) => {
                    setPageQuery(event.target.value.replace(/[^0-9]/g, ""));
                    setGalleryPage(1);
                  }}
                />
                {pageQuery && (
                  <button
                    className="button compactButton"
                    onClick={() => {
                      setPageQuery("");
                      setGalleryPage(1);
                    }}
                  >
                    Xóa lọc
                  </button>
                )}
              </div>
            </div>

            <div className="galleryActions">
              {jobId && (
                <>
                  <a className="button compactButton" href={`${API_BASE}/api/books/${jobId}/download`}>
                    Thu toàn bộ ảnh
                  </a>
                  <a className="button compactButton" href={`${API_BASE}/api/books/${jobId}/recognized.json`}>
                    Xuất kỳ văn FEN
                  </a>
                </>
              )}
            </div>
          </div>

          {pageQuery && filteredPositions.length === 0 && (
            <div className="emptySearch">
              Không tìm thấy hình cờ ở trang PDF {pageQuery}.
            </div>
          )}

          <div className="grid compactGalleryGrid">
            {visiblePositions.map((position) => (
              <article className="card" key={position.id}>
                <div className="imageWrap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={position.imageUrl} alt={`Chess position ${position.id}`} />
                </div>
                <div className="cardBody">
                  <div>
                    <strong>Kỳ trận #{position.id}</strong>
                    <p className="subtle">
                      Trang / ảnh nguồn: {position.page} · độ tin cậy detector {(position.confidence * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div className="actions">
                    <a className="button" href={position.imageUrl} download target="_blank" rel="noreferrer">Tải ảnh</a>
                    <Link
                      className="button primaryLink"
                      href={`/analysis?job=${jobId}&position=${position.id}&image=${encodeURIComponent(position.imageUrl)}`}
                    >
                      Quan trận · nhập đạo
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {filteredPositions.length > PAGE_SIZE && (
            <div className="galleryPager">
              <button
                className="button"
                disabled={galleryPage <= 1}
                onClick={() => setGalleryPage((page) => Math.max(1, page - 1))}
              >
                ← Trang trước
              </button>
              <span>
                {galleryPage} / {totalGalleryPages}
              </span>
              <button
                className="button"
                disabled={galleryPage >= totalGalleryPages}
                onClick={() =>
                  setGalleryPage((page) => Math.min(totalGalleryPages, page + 1))
                }
              >
                Trang sau →
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
