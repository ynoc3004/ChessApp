export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export function resolveImageUrl(value: string): string {
  if (!value) return "";
  // Old book.json files stored localhost:8000 as an absolute URL.
  const legacy = /^https?:\/\/(?:localhost|127\.0\.0\.1):8000(\/files\/.*)$/i.exec(value);
  const path = legacy?.[1] ?? value;
  return path.startsWith("/files/") ? `${API_BASE.replace(/\/$/, "")}${path}` : path;
}

export type Position = {
  id: number;
  page: number;
  confidence: number;
  imageUrl: string;
  needsReview?: boolean;
  source?: string;
};

export type UploadResponse = {
  jobId: string;
  filename: string;
  count: number;
  positions: Position[];
  skippedVectorImages?: number;
  scannerVersion?: number;
  scanRange?: { start: number; end: number; sourceTotal: number };
};

export type BookSummary = {
  jobId: string;
  filename: string;
  count: number;
  updatedAt: number;
};

export type BookListResponse = {
  books: BookSummary[];
};

export type ScanFailedPage = {
  page: number;
  error: string;
};

export type ScanJob = {
  jobId: string;
  filename: string;
  status: "queued" | "processing" | "paused" | "completed" | "failed";
  phase?: "prepare" | "detect" | "paused" | "done" | "failed" | string;
  current: number;
  total: number;
  progress: number;
  count: number;
  positions: Position[];
  error?: string | null;
  skippedVectorImages?: number;
  scannerVersion?: number;
  pageStart?: number;
  pageEnd?: number;
  sourceTotal?: number;
  currentPage?: number | null;
  processedPages?: number[];
  failedPages?: ScanFailedPage[];
  pageStates?: Record<string, "pending" | "processing" | "completed" | "failed" | string>;
  reviewCount?: number;
  retryPage?: number;
};
