export type AdminPrincipal = {
  id: string;
  username: string;
  displayName: string;
  role: "owner" | "admin" | "moderator" | "user" | string;
  authType: "bootstrap" | "account" | string;
  permissions: string[];
};

export type AdminSessionResponse = {
  ok: boolean;
  principal: AdminPrincipal;
};

export type AdminLoginResponse = {
  token: string;
  expiresAt: number;
  principal: AdminPrincipal;
};

export type AdminUser = {
  id: string;
  username: string;
  displayName: string;
  role: "owner" | "admin" | "moderator" | "user" | string;
  enabled: boolean;
  createdAt?: number | null;
  updatedAt?: number | null;
  lastLoginAt?: number | null;
  authType: "bootstrap" | "account" | string;
  immutable: boolean;
  permissions: string[];
};

export type AdminRole = {
  name: string;
  description: string;
  permissions: string[];
};

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

export type AdminBookPosition = {
  id: number;
  page?: number | null;
  confidence?: number | null;
  imageUrl: string;
  hasImage: boolean;
  imageBytes: number;
  state: "pending" | "recognized" | "corrected";
  recognized: boolean;
  corrected: boolean;
  aiFen?: string | null;
  savedFen?: string | null;
  averageConfidence?: number | null;
  suggestedOrientation?: string | null;
  uncertainSquares: string[];
  savedAt?: number | null;
  recognitionUpdatedAt?: number | null;
  variantCount: number;
};

export type AdminBookDetail = {
  jobId: string;
  filename: string;
  status: string;
  progress: number;
  error?: string | null;
  count: number;
  updatedAt: number;
  source: {
    available: boolean;
    extension?: string | null;
    bytes: number;
  };
  dataBytes: number;
  stats: {
    recognized: number;
    corrected: number;
    pending: number;
    missingImages: number;
  };
  positions: AdminBookPosition[];
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

export type DatasetSquareDiff = {
  square: string;
  aiPiece: string | null;
  correctedPiece: string | null;
};

export type AdminDatasetSample = AdminCorrection & {
  corners?: { x0: number; y0: number; x1: number; y1: number } | null;
  imageBytes: number;
  changed: boolean;
  changedSquares: number;
  validCorrectedFen: boolean;
  validAiFen: boolean;
  diffs: DatasetSquareDiff[];
};

export type AdminDatasetStats = {
  total: number;
  changed: number;
  confirmed: number;
  missingAiFen: number;
  withImage: number;
  missingImage: number;
  invalidCorrectedFen: number;
  datasetBytes: number;
  averageChangedSquares: number;
  recognizers: { name: string; count: number }[];
  preprocessVariants: { name: string; count: number }[];
  orientations: { name: string; count: number }[];
  topErrorSquares: { square: string; count: number }[];
};

export type AdminDatasetSamplesResponse = {
  samples: AdminDatasetSample[];
  total: number;
  filtered: number;
  offset: number;
  limit: number;
};

export type AdminAuditEvent = {
  id: number;
  createdAt: number;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  status: "success" | "failure" | "started";
  message?: string | null;
  details: Record<string, unknown>;
  actor?: {
    id?: string | null;
    displayName?: string | null;
    role?: string | null;
    authType?: string | null;
  } | null;
};

export type AdminAuditResponse = {
  events: AdminAuditEvent[];
  total: number;
  limit: number;
  offset: number;
};

export type AdminAuditStats = {
  total: number;
  success: number;
  failure: number;
  last24Hours: number;
  topActions: { name: string; count: number }[];
  topResources: { name: string; count: number }[];
  topActors: { name: string; count: number }[];
  databaseBytes: number;
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

export type AdminBackup = {
  id: string;
  filename: string;
  createdAt: number;
  scope: "core" | "full" | "unknown" | string;
  fileCount: number;
  contentBytes: number;
  archiveBytes: number;
  includesPuzzleDb: boolean;
  valid: boolean;
};

export type AdminMaintenanceSummary = {
  backups: AdminBackup[];
  backupCount: number;
  backupBytes: number;
  latestBackupAt: number | null;
  coreExcludesPuzzleDb: boolean;
};

export type AdminIntegrityDatabase = {
  name: string;
  exists: boolean;
  status: "ok" | "missing" | "error" | string;
  message: string;
  bytes: number;
  durationMs?: number;
};

export type AdminIntegrityReport = {
  healthy: boolean;
  checked: number;
  errors: number;
  databases: AdminIntegrityDatabase[];
  checkedAt: number;
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
