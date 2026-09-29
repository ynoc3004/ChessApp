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
};

export type UploadResponse = {
  jobId: string;
  filename: string;
  count: number;
  positions: Position[];
  skippedVectorImages?: number;
};


export type BookSummary = UploadResponse & {
  updatedAt?: number;
};

export type BookListResponse = {
  books: BookSummary[];
};


export type ScanJob = {
  jobId: string;
  filename: string;
  status: "queued" | "processing" | "completed" | "failed";
  current: number;
  total: number;
  progress: number;
  count: number;
  positions: Position[];
  error?: string | null;
  skippedVectorImages?: number;
};
