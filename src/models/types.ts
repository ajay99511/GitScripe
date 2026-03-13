// ─── Domain Types ────────────────────────────────────────
// Pure data structures — no database or framework dependencies

export interface RepositoryInfo {
  id: string;
  githubUrl: string;
  owner: string;
  name: string;
  branch: string;
  lastSyncedSha: string | null;
  status: 'idle' | 'syncing' | 'error';
}

export interface CommitInfo {
  sha: string;
  repoId: string;
  authorName: string;
  authorEmail: string;
  message: string;
  committedAt: Date;
  filesChanged: string[];
  additions: number;
  deletions: number;
  diffObjectKey?: string;
}

export interface DiffAnalysis {
  filesChanged: FileChange[];
  functionsModified: string[];
  linesAdded: number;
  linesRemoved: number;
  rawSummary: string;
}

export interface FileChange {
  path: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  summary: string;
}

export interface SummaryDraft {
  shortSummary: string;
  detailedSummary: string;
  inferredIntent: string;
  fileSummaries: Record<string, string>;
  moduleSummaries: Record<string, string>;
  tags: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

export interface SummaryInfo {
  id: string;
  commitSha: string;
  repoId: string;
  shortSummary: string;
  detailedSummary: string;
  inferredIntent: string;
  fileSummaries: Record<string, string>;
  moduleSummaries: Record<string, string>;
  tags: string[];
  riskLevel: 'low' | 'medium' | 'high';
  qualityScore: number | null;
  llmModel: string | null;
  processingMs: number | null;
  status: 'pending' | 'processing' | 'done' | 'failed';
  errorMessage: string | null;
  embedding?: number[];
  createdAt: Date;
}

export interface ChatResponse {
  answer: string;
  citations: CitedCommit[];
}

export interface CitedCommit {
  sha: string;
  shortSummary: string;
  committedAt: Date;
  relevanceScore: number;
}

export interface SyncProgress {
  total: number;
  processed: number;
  failed: number;
  pending: number;
}

// ─── Pipeline State ──────────────────────────────────────

export interface PipelineState {
  commit: CommitInfo;
  diff: string;
  diffAnalysis: DiffAnalysis | null;
  summaryDraft: SummaryDraft | null;
  qualityScore: number | null;
  extractedConcepts: string[];
  retryCount: number;
  error: string | null;
}
