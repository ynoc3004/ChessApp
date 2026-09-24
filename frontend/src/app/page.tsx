"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  API_BASE,
  type BookListResponse,
  type BookSummary,
  type Position,
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

  function openBook(book: UploadResponse) {
    setJobId(book.jobId);
    setFilename(book.filename);
    setPositions(book.positions);
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

    const body = new FormData();
    body.append("file", file);

    try {
      const response = await fetch(`${API_BASE}/api/books`, { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail ?? "Upload failed");
      const result = data as UploadResponse;
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
    <main className="shell">
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
        {restoring && <p className="subtle">Đang khôi phục lần quét gần nhất…</p>}
        {error && <p className="error">{error}</p>}
      </form>

      {recentBooks.length > 0 && (
        <section className="recentBooks">
          <div className="sectionHeading">
            <div>
              <p className="eyebrow">LỊCH SỬ LOCAL</p>
              <h2>Các sách đã quét gần đây</h2>
            </div>
            <p className="subtle">Dữ liệu nằm trên máy đang chạy backend.</p>
          </div>

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
                  <a
                    className="button"
                    href={`${API_BASE}/api/books/${book.jobId}/download`}
                  >
                    Tải ZIP
                  </a>
                  <button
                    className="button dangerButton"
                    onClick={() => void deleteBook(book)}
                  >
                    Xóa
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {positions.length > 0 && (
        <section className="results">
          <div className="sectionHeading">
            <div>
              <p className="eyebrow">KẾT QUẢ</p>
              <h2>Tìm thấy {positions.length} hình cờ</h2>
            </div>
            <div className="resultHeaderActions">
              <p className="subtle">{filename}</p>
              {jobId && (
                <a
                  className="button"
                  href={`${API_BASE}/api/books/${jobId}/download`}
                >
                  Tải tất cả ảnh (.zip)
                </a>
              )}
            </div>
          </div>

          <div className="grid">
            {positions.map((position) => (
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
        </section>
      )}
    </main>
  );
}
