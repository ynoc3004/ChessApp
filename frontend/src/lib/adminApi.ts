export type AdminStats = {
  books: number;
  diagrams: number;
  bookStatuses: Record<string, number>;
  collection: number;
  corrections: number;
  puzzles: number;
  puzzleReady: boolean;
  stockfish: { available: boolean; source: string | null; path: string | null };
  storageBytes: number;
  uptimeSeconds: number;
};

export type AdminBook = {
  jobId: string;
  filename: string;
  count: number;
  status: string;
  progress: number;
  error?: string | null;
  updatedAt: number;
  sourceBytes: number;
  dataBytes: number;
};

export type PuzzleStats = {
  ready: boolean;
  count: number;
  ratingMin: number | null;
  ratingMax: number | null;
  themeCount: number;
  databaseBytes: number;
  updatedAt: number | null;
  source: Record<string, unknown>;
  topThemes: { theme: string; count: number }[];
  ratingBuckets: { rating: number; count: number }[];
  error?: string;
};

export type PuzzleUpdateState = {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  changed: boolean | null;
};

export type AdminCorrection = {
  sampleId: string;
  jobId?: string | null;
  positionId?: number | null;
  correctedFen?: string | null;
  aiFen?: string | null;
  recognizer?: string | null;
  preprocessVariant?: string | null;
  imageOrientation?: string | null;
  savedAt?: number | null;
  hasImage: boolean;
};

export type AdminCollectionItem = {
  id: string;
  title?: string;
  fen?: string;
  source?: string;
  sourcePath?: string;
  themes?: string;
  note?: string;
  updatedAt?: number;
};

export type AdminSystem = {
  backend: { online: boolean; uptimeSeconds: number };
  stockfish: { available: boolean; source: string | null; path: string | null };
  python: string;
  platform: string;
  dataDirectory: string;
  storageBytes: number;
  booksBytes: number;
  puzzleBytes: number;
  correctionBytes: number;
  adminConfigured: boolean;
  puzzleUpdate: PuzzleUpdateState;
};

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatTime(timestamp?: number | null) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp * 1000));
}

export function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days} ngày ${hours} giờ`;
  if (hours) return `${hours} giờ ${minutes} phút`;
  return `${minutes} phút`;
}
