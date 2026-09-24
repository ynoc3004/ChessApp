export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

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
};


export type BookSummary = UploadResponse & {
  updatedAt?: number;
};

export type BookListResponse = {
  books: BookSummary[];
};
