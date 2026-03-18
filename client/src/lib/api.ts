// Mirrored TypeScript types matching backend models
export interface DiscoveredRepo {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  htmlUrl: string;
  isRegistered: boolean;
}

export interface RepositoryInfo {
  id: string;
  githubUrl: string;
  owner: string;
  name: string;
  branch: string;
  lastSyncedSha: string | null;
  status: 'idle' | 'syncing' | 'error';
}

export interface SyncProgress {
  total: number;
  processed: number;
  failed: number;
  pending: number;
}

export interface SummaryInfo {
  id: string;
  repoId: string;
  commitSha: string;
  shortSummary: string;
  detailedSummary: string;
  inferredIntent: string;
  authorName: string;
  committedAt: string;
  riskLevel: 'low' | 'medium' | 'high';
  tags: string[];
  qualityScore: number | null;
  fileSummaries: Record<string, string>;
  extractedConcepts: string[];
  htmlUrl: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  filesChanged: string[];
  additions: number;
  deletions: number;
}

export interface CitedCommit {
  sha: string;
  shortSummary: string;
  htmlUrl: string;
}

export interface ChatResponse {
  answer: string;
  citedCommits: CitedCommit[];
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error((body as { error?: string }).error ?? `HTTP ${res.status}`), {
      status: res.status,
      body,
    });
  }
  return res.json() as Promise<T>;
}

export const api = {
  github: {
    listRepos: () => apiFetch<{ repos: DiscoveredRepo[] }>('/github/repos'),
    register: (fullName: string, branch?: string) =>
      apiFetch<RepositoryInfo>('/github/repos/register', {
        method: 'POST',
        body: JSON.stringify({ fullName, branch }),
      }),
  },
  repos: {
    list: () => apiFetch<{ repos: RepositoryInfo[] }>('/repos'),
    sync: (id: string) =>
      apiFetch<{ message: string }>(`/repos/${id}/sync`, { method: 'POST', body: '{}' }),
    progress: (id: string) =>
      apiFetch<{ repo: RepositoryInfo; progress: SyncProgress }>(`/repos/${id}/progress`),
  },
  summaries: {
    list: (
      repoId: string,
      params: { page?: number; limit?: number; riskLevel?: string; tag?: string }
    ) => {
      const qs = new URLSearchParams();
      if (params.page) qs.set('page', String(params.page));
      if (params.limit) qs.set('limit', String(params.limit));
      return apiFetch<{ summaries: SummaryInfo[]; pagination: { total: number; pages: number; page: number; limit: number } }>(
        `/repos/${repoId}/summaries?${qs}`
      );
    },
  },
  chat: {
    query: (question: string, repoId: string) =>
      apiFetch<ChatResponse>('/chat', {
        method: 'POST',
        body: JSON.stringify({ question, repoId }),
      }),
  },
};
