"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  API_BASE,
  type BookListResponse,
  type BookSummary,
  type Position,
  type ScanJob,
  type UploadResponse,
} from "@/lib/api";

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
      <section className="hero">
        <p className="eyebrow">CHESS BOOK READER · PHASE 2.1</p>
        <h1>Biến sách cờ thành các thế cờ có thể phân tích trực tiếp.</h1>
        <p className="subtle">
          Upload PDF hoặc DOCX. Hệ thống tìm diagram; khi bạn mở một thế cờ, AI sẽ đọc 64 ô, tự tạo FEN, cho phép sửa quân bằng click rồi mở thẳng thế cờ trên Lichess.
        </p>
      </section>

      <form className="uploadCard" onSubmit={submit}>
        <label className="dropzone">
          <span className="dropTitle">Chọn sách PDF / DOCX</span>
          <span className="subtle">File được xử lý trên backend local của bạn.</span>
          <input
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button className="primary" disabled={!file || loading}>
          {loading ? "Đang quét sách…" : "Tìm các thế cờ"}
        </button>
        {file && <p className="subtle">Đã chọn: {file.name}</p>}
        {scanJob && loading && (
          <div className="scanProgress">
            <div className="scanProgressHeader">
              <strong>
                {scanJob.status === "queued" ? "Đang chuẩn bị…" : "Đang quét sách…"}
              </strong>
              <span>{scanJob.progress.toFixed(1)}%</span>
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
              · đã tìm thấy {scanJob.count} hình cờ.
            </p>
          </div>
        )}
        {restoring && <p className="subtle">Đang khôi phục lần quét gần nhất…</p>}
        {error && <p className="error">{error}</p>}
      </form>

      {recentBooks.length > 0 && (
        <details className="recentBooks recentBooksCompact">
          <summary>
            Sách đã quét gần đây ({recentBooks.length})
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
                    Mở gallery
                  </button>
                  <a className="button" href={`${API_BASE}/api/books/${book.jobId}/download`}>
                    ZIP
                  </a>
                  <a className="button" href={`${API_BASE}/api/books/${book.jobId}/recognized.json`}>
                    FEN
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
              <p className="eyebrow">KẾT QUẢ · {filename}</p>
              <h2>{positions.length} hình cờ</h2>
            </div>

            <div className="pageSearch">
              <label htmlFor="page-search">Tìm theo trang PDF</label>
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
                    Tải ZIP
                  </a>
                  <a className="button compactButton" href={`${API_BASE}/api/books/${jobId}/recognized.json`}>
                    Xuất FEN
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
                    <strong>Thế #{position.id}</strong>
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
                      AI đọc FEN & phân tích
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
