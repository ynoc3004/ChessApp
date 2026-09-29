"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./home.module.css";
import BaguaSeal from "@/components/BaguaSeal";
import {
  API_BASE,
  resolveImageUrl,
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
  const [skippedVectorImages, setSkippedVectorImages] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [dragging, setDragging] = useState(false);
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
  const isDocx = /\.docx$/i.test(filename);
  const sourceLabel = isDocx ? "ảnh số" : "trang PDF";

  const visiblePositions = filteredPositions.slice(
    (galleryPage - 1) * PAGE_SIZE,
    galleryPage * PAGE_SIZE,
  );

  function openBook(book: UploadResponse) {
    setJobId(book.jobId);
    setFilename(book.filename);
    setSkippedVectorImages(book.skippedVectorImages ?? 0);
    setPositions(book.positions);
    setPageQuery("");
    setGalleryPage(1);
    window.localStorage.setItem("chessBookReader:lastJobId", book.jobId);
  }

  async function openRecentBook(book: BookSummary) {
    setRestoring(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/books/${book.jobId}`);
      if (!response.ok) throw new Error("Không mở được sách.");
      openBook((await response.json()) as UploadResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không mở được sách.");
    } finally {
      setRestoring(false);
    }
  }

  async function loadRecentBooks() {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await fetch(`${API_BASE}/api/books`);
      const data = (await response.json()) as BookListResponse;
      if (!response.ok) throw new Error("Không tải được thư viện");
      setRecentBooks(data.books ?? []);
    } catch {
      setHistoryError("Chưa kết nối được thư viện. Kiểm tra dịch vụ xử lý sách rồi thử lại.");
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    void loadRecentBooks();
    const savedJobId = window.localStorage.getItem("chessBookReader:lastJobId");
    if (!savedJobId) return;

    const controller = new AbortController();
    setRestoring(true);
    void (async () => {
      try {
        const statusResponse = await fetch(`${API_BASE}/api/jobs/${savedJobId}`, {
          cache: "no-store", signal: controller.signal,
        });
        if (statusResponse.ok) {
          const job = (await statusResponse.json()) as ScanJob;
          if (controller.signal.aborted) return;
          setJobId(savedJobId);
          setFilename(job.filename || "");
          setSkippedVectorImages(job.skippedVectorImages ?? 0);
          setScanJob(job);
          setPositions(job.positions ?? []);
          if (job.status === "queued" || job.status === "processing") setLoading(true);
          else if (job.status === "failed") setError(job.error || "Quét sách thất bại");
          else openBook({ jobId: savedJobId, filename: job.filename, count: job.count, positions: job.positions ?? [], skippedVectorImages: job.skippedVectorImages });
          return;
        }
        if (statusResponse.status !== 404) throw new Error("Không đọc được tiến trình quét.");
        const response = await fetch(`${API_BASE}/api/books/${savedJobId}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Không khôi phục được sách.");
        const book = (await response.json()) as UploadResponse;
        if (!controller.signal.aborted) openBook(book);
      } catch {
        if (!controller.signal.aborted) setError("Không nối lại được lần quét trước. Kiểm tra backend rồi tải lại trang.");
      } finally {
        if (!controller.signal.aborted) setRestoring(false);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!jobId || !scanJob || !["queued", "processing"].includes(scanJob.status)) return;
    const controller = new AbortController();
    let timer: number;
    const poll = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/jobs/${jobId}`, {
          cache: "no-store", signal: controller.signal,
        });
        if (response.status === 503) {
          timer = window.setTimeout(poll, 750);
          return;
        }
        const current = (await response.json()) as ScanJob;
        if (!response.ok) throw new Error("Không đọc được tiến trình quét.");
        if (controller.signal.aborted) return;
        setScanJob(current);
        setSkippedVectorImages(current.skippedVectorImages ?? 0);
        setPositions(current.positions ?? []);
        if (current.status === "failed") {
          setError(current.error || "Quét sách thất bại");
          setLoading(false);
        } else if (current.status === "completed") {
          openBook({ jobId, filename: current.filename, count: current.count, positions: current.positions ?? [], skippedVectorImages: current.skippedVectorImages });
          setLoading(false);
          void loadRecentBooks();
        } else {
          timer = window.setTimeout(poll, 750);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Không đọc được tiến trình quét.");
        setLoading(false);
      }
    };
    timer = window.setTimeout(poll, 750);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [jobId, scanJob?.status]);

  function selectFile(next: File | null) {
    setError("");
    if (next && !/\.(pdf|docx)$/i.test(next.name)) {
      setFile(null);
      setError("Vui lòng chọn sách định dạng PDF hoặc DOCX.");
      return;
    }
    setFile(next);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || loading || restoring) return;

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

      const current = data as ScanJob;
      window.localStorage.setItem("chessBookReader:lastJobId", current.jobId);
      setScanJob(current);
      setSkippedVectorImages(0);
      setJobId(current.jobId);
      setFilename(current.filename || file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra");
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
        setSkippedVectorImages(0);
        setPositions([]);
        window.localStorage.removeItem("chessBookReader:lastJobId");
      }
      await loadRecentBooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xóa được");
    }
  }

  return (
    <main className={styles.home}>
      <a className={styles.skipLink} href="#upload">Đến phần nhập sách</a>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="Kỳ Phổ Đạo Các — trang chủ">
          <span className={styles.brandMark} aria-hidden="true">♞</span>
          <span><strong>Kỳ Phổ Đạo Các</strong><small>Không gian học cờ của bạn</small></span>
        </Link>
        <nav className={styles.navigation} aria-label="Điều hướng chính">
          <a href="#upload">Nhập kỳ phổ</a>
          <a href="#library">Thư viện sách</a>
          <Link href="/collection">Tàng Kinh Các</Link>
          <Link href="/realms">Bí Cảnh</Link>
        </nav>
      </header>
      <div className={styles.content}>
      <section className={styles.hero} aria-labelledby="welcome-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>TÀNG KINH CÁC · HỌC CỜ TỪ SÁCH</p>
          <h1 id="welcome-title">Mỗi thế cờ,<br />một điều khai mở.</h1>
          <p className={styles.intro}>Mang kỳ phổ lên bàn cờ. Tách hình từ sách, thử từng nước đi và khám phá thế trận cùng Stockfish.</p>
          <a className={styles.heroLink} href="#upload">Bắt đầu với một cuốn sách <span aria-hidden="true">↗</span></a>
        </div>
        <Link href="/realms" className={styles.sealScene} aria-label="Mở Bát Quái Bí Cảnh">
          <BaguaSeal className={styles.baguaSeal} />
          <p>BÁT QUÁI · TỨ TƯỢNG</p>
          <span>Mở cửa luyện tập →</span>
        </Link>
      </section>
      <div className={styles.guardianRibbon} aria-label="Tứ Tượng">
        <span>Thanh Long</span><i aria-hidden="true">✦</i><span>Bạch Hổ</span><i aria-hidden="true">✦</i><span>Chu Tước</span><i aria-hidden="true">✦</i><span>Huyền Vũ</span>
      </div>
      <div className={styles.workspace}>
      <section className={styles.importSection} id="upload" aria-labelledby="import-title">
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>01 / KHAI PHỔ</p><h2 id="import-title">Nhập sách của bạn</h2></div><span className={styles.formatBadge}>PDF · DOCX</span></div>
      <form className={styles.uploadCard} onSubmit={submit}>
        <label
          className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`}
          onDragOver={(event) => { event.preventDefault(); if (!loading) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!loading) selectFile(event.dataTransfer.files[0] ?? null);
          }}
        >
          <span className={styles.uploadIcon} aria-hidden="true">↑</span>
          <span className={styles.dropTitle}>{file ? file.name : "Kéo sách vào đây"}</span>
          <span className={styles.subtle}>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · Sẵn sàng để quét` : "hoặc bấm để chọn tệp PDF / DOCX"}</span>
          <input
            className={styles.fileInput}
            aria-label="Chọn sách PDF hoặc DOCX"
            type="file"
            disabled={loading}
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button className={styles.primary} disabled={!file || loading || restoring}>
          {loading ? "Đang quét kỳ phổ…" : "Quét sách và tìm thế cờ →"}
        </button>
        <p className={styles.privacyNote}>Sách được gửi đến dịch vụ xử lý bạn đã cấu hình.</p>
        {scanJob && loading && (
          <div className={styles.scanProgress}>
            <div className={styles.scanScene} aria-hidden="true">
              <span className={styles.scanMoon} />
              <span className={styles.scanScroll}><span>棋</span></span>
              <span className={styles.scanPage} />
              <span className={styles.scanPage} />
              <span className={styles.scanSpark}>✦</span>
            </div>
            <div className={styles.cultivationHeader}>
              <div className={styles.realmSeal} aria-hidden="true">{scanCultivation.mark}</div>
              <div>
                <span className={styles.realmKicker}>CẢNH GIỚI QUÉT PHỔ</span>
                <strong>{scanJob.status === "queued" ? "Tụ Khí" : scanCultivation.name}</strong>
                <small>{scanJob.status === "queued" ? "Đang chuẩn bị pháp trận xử lý" : scanCultivation.note}</small>
              </div>
              <span className={styles.realmPercent}>{scanJob.progress.toFixed(1)}%</span>
            </div>
            <div className={styles.progressTrack} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, scanJob.progress))} aria-label="Tiến trình quét">
              <div
                className={styles.progressFill}
                style={{ width: `${Math.max(1, scanJob.progress)}%` }}
              />
            </div>
            <p className={styles.subtle}>
              {scanJob.total > 0
                ? `Đã xử lý ${scanJob.current} / ${scanJob.total}`
                : "Đang đọc thông tin tài liệu"}{" "}
              · đã lĩnh hội {scanJob.count} kỳ đồ.
            </p>
            <div className={styles.scanMilestones} aria-label="Các chặng quét sách">
              {["Khai Phổ", "Quan Trận", "Ngộ Cục", "Khắc Ấn"].map((stage, index) => (
                <span key={stage} aria-current={scanJob.progress >= [0, 20, 50, 80][index] && scanJob.progress < [20, 50, 80, 100][index] ? "step" : undefined}>
                  {stage}
                </span>
              ))}
            </div>
          </div>
        )}
        {restoring && <p className={styles.subtle}>☁ Đang triệu hồi kỳ phổ gần nhất từ Tàng Kinh Các…</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {skippedVectorImages > 0 && <p className={styles.notice} role="status">Đã bỏ qua {skippedVectorImages} ảnh EMF/WMF trong DOCX vì định dạng này chưa đọc được.</p>}
        {scanJob?.status === "completed" && positions.length === 0 && (
          <p className={styles.notice} role="status">Đã quét xong nhưng chưa tìm thấy hình cờ. Thử sách có hình bàn cờ rõ hơn.</p>
        )}
      </form>
      </section>
      <aside className={styles.guide} aria-labelledby="guide-title">
        <p className={styles.eyebrow}>HÀNH TRÌNH HỌC CỜ</p>
        <h2 id="guide-title">Từ trang sách<br />đến bàn cờ.</h2>
        <ol className={styles.steps}>
          <li><span>01</span><div><strong>Chọn kỳ phổ</strong><p>Tải sách PDF hoặc DOCX bạn muốn học.</p></div></li>
          <li><span>02</span><div><strong>Khám phá thế cờ</strong><p>Xem các hình cờ tìm được, lọc theo trang sách.</p></div></li>
          <li><span>03</span><div><strong>Thử nước, hiểu sâu</strong><p>Kiểm tra bàn cờ nhận diện và phân tích bằng Stockfish.</p></div></li>
        </ol>
        <p className={styles.guideNote}>Một thế cờ hay đáng để bạn dừng lại.</p>
      </aside>
      </div>

        <section className={styles.recentBooks} id="library" aria-labelledby="library-title" aria-busy={historyLoading}>
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>02 / TIẾP TỤC KHÁM PHÁ</p><h2 id="library-title">Kỳ phổ của bạn</h2></div><span className={styles.formatBadge}>{recentBooks.length} cuốn sách</span></div>
          {historyLoading && <p className={styles.subtle} role="status">Đang tải thư viện…</p>}
          {historyError && <div className={styles.notice} role="status"><span>{historyError}</span><button className={styles.button} onClick={() => void loadRecentBooks()}>Thử lại</button></div>}
          {!historyLoading && !historyError && recentBooks.length === 0 && <div className={styles.emptyLibrary}><span aria-hidden="true">▤</span><div><strong>Cuốn kỳ phổ đầu tiên đang chờ bạn</strong><p>Sách đã quét sẽ xuất hiện ở đây để bạn tiếp tục học bất cứ lúc nào.</p></div><a className={styles.button} href="#upload">Nhập sách đầu tiên ↑</a></div>}
          <div className={styles.recentBookList}>
            {recentBooks.map((book) => (
              <article className={styles.recentBookItem} key={book.jobId}>
                <div>
                  <strong>{book.filename}</strong>
                  <p className={styles.subtle}>{book.count} hình cờ</p>
                </div>
                <div className={styles.actions}>
                  <button className={styles.button} disabled={loading || restoring} onClick={() => void openRecentBook(book)}>
                    Mở sách
                  </button>
                  <a className={styles.button} href={`${API_BASE}/api/books/${book.jobId}/download`}>
                    Tải ảnh ZIP
                  </a>
                  <a className={styles.button} href={`${API_BASE}/api/books/${book.jobId}/recognized.json`}>
                    Xuất FEN
                  </a>
                  <button className={styles.button + " " + styles.dangerButton} disabled={loading || restoring} onClick={() => void deleteBook(book)}>
                    Xóa
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

      {positions.length > 0 && (
        <section className={styles.results}>
          <div className={styles.galleryToolbar}>
            <div>
              <p className={styles.eyebrow}>KỲ PHỔ · {filename}</p>
              <h2>{positions.length} thế cờ trong sách</h2>
            </div>

            <div className={styles.pageSearch}>
              <label htmlFor="page-search">Tìm theo {sourceLabel}</label>
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
                    className={styles.button}
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

            <div className={styles.galleryActions}>
              {jobId && (
                <>
                  <a className={styles.button} href={`${API_BASE}/api/books/${jobId}/download`}>
                    Tải toàn bộ ảnh
                  </a>
                  <a className={styles.button} href={`${API_BASE}/api/books/${jobId}/recognized.json`}>
                    Xuất FEN
                  </a>
                </>
              )}
            </div>
          </div>

          {pageQuery && filteredPositions.length === 0 && (
            <div className={styles.emptySearch}>
              Không tìm thấy hình cờ ở {sourceLabel} {pageQuery}.
            </div>
          )}

          <div className={styles.grid}>
            {visiblePositions.map((position) => (
              <article className={styles.card} key={position.id}>
                <div className={styles.imageWrap}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={resolveImageUrl(position.imageUrl)} alt={`Chess position ${position.id}`} />
                </div>
                <div className={styles.cardBody}>
                  <div>
                    <strong>Kỳ trận #{position.id}</strong>
                    <p className={styles.subtle}>
                      {isDocx ? "Ảnh số" : "Trang PDF"}: {position.page} · độ tin cậy detector {(position.confidence * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div className={styles.actions}>
                    <a className={styles.button} href={resolveImageUrl(position.imageUrl)} download target="_blank" rel="noreferrer">Tải ảnh</a>
                    <Link
                      className={styles.button + " " + styles.primaryLink}
                      href={`/analysis?job=${jobId}&position=${position.id}&image=${encodeURIComponent(position.imageUrl)}`}
                    >
                      Phân tích thế cờ →
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {filteredPositions.length > PAGE_SIZE && (
            <div className={styles.galleryPager}>
              <button
                className={styles.button}
                disabled={galleryPage <= 1}
                onClick={() => setGalleryPage((page) => Math.max(1, page - 1))}
              >
                ← Trang trước
              </button>
              <span>
                {galleryPage} / {totalGalleryPages}
              </span>
              <button
                className={styles.button}
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
      <footer className={styles.footer}><span>♞ Kỳ Phổ Đạo Các</span><span>Tĩnh tâm học cờ · Từng nước tiến bộ</span></footer>
      </div>
    </main>
  );
}
