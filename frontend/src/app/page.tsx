"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { API_BASE, Position, UploadResponse } from "@/lib/api";

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [jobId, setJobId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");

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
      setFilename(result.filename);
      setJobId(result.jobId);
      setPositions(result.positions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">CHESS BOOK READER · PHASE 2</p>
        <h1>Biến sách cờ thành các thế cờ có thể phân tích trực tiếp.</h1>
        <p className="subtle">
          Upload PDF hoặc DOCX. Hệ thống tìm diagram; khi bạn mở một thế cờ, AI sẽ đọc 64 ô và tự tạo FEN.
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
        {error && <p className="error">{error}</p>}
      </form>

      {positions.length > 0 && (
        <section className="results">
          <div className="sectionHeading">
            <div>
              <p className="eyebrow">KẾT QUẢ</p>
              <h2>Tìm thấy {positions.length} hình cờ</h2>
            </div>
            <p className="subtle">{filename}</p>
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
