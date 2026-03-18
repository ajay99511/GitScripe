import { useState, type ChangeEvent } from 'react';
import type { DiscoveredRepo, RepositoryInfo } from '../lib/api';
import { useGithubRepos } from '../hooks/useGithubRepos';
import { useRepos } from '../hooks/useRepos';
import { RepoRow } from '../components/repos/RepoRow';
import { SyncProgressModal } from '../components/repos/SyncProgressModal';

export function DiscoverPage() {
  const [search, setSearch] = useState('');
  const [syncingRepoId, setSyncingRepoId] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch, isFetching } = useGithubRepos();
  const { data: reposData } = useRepos();

  const repos = data?.repos ?? [];
  const registeredRepos = reposData?.repos ?? [];

  const filtered = search
    ? repos.filter((r: DiscoveredRepo) => r.fullName.toLowerCase().includes(search.toLowerCase()))
    : repos;

  const normalizeUrl = (url: string) =>
    url.toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '');

  const getRegisteredRepo = (htmlUrl: string) =>
    registeredRepos.find(
      (r: RepositoryInfo) => normalizeUrl(r.githubUrl) === normalizeUrl(htmlUrl)
    );

  return (
    <div className="p-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h1 className="text-[#e6edf3] text-xl font-semibold">Discover Repositories</h1>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="px-3 py-1.5 text-sm bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] rounded min-h-[44px] min-w-[44px] disabled:opacity-50 transition-colors"
        >
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="search"
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          placeholder="Filter repositories…"
          className="w-full bg-[#21262d] border border-[#30363d] text-[#e6edf3] text-sm rounded px-3 py-2 min-h-[44px] focus:outline-none focus:border-[#58a6ff] placeholder-[#8b949e]"
        />
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <ul className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <li key={i} className="h-16 bg-[#161b22] rounded animate-pulse border border-[#30363d]" />
          ))}
        </ul>
      )}

      {/* Error state */}
      {isError && (
        <div className="p-4 bg-[#3d1f1f] border border-[#f85149] rounded text-[#f85149] text-sm">
          {error instanceof Error ? error.message : 'Failed to load repositories'}
        </div>
      )}

      {/* Repo list */}
      {!isLoading && !isError && (
        <>
          <p className="text-[#8b949e] text-xs mb-2">{filtered.length} repositories</p>
          <ul className="border border-[#30363d] rounded-lg overflow-hidden bg-[#0f1117]">
            {filtered.length === 0 ? (
              <li className="px-4 py-8 text-center text-[#8b949e] text-sm">
                {search ? 'No repositories match your search.' : 'No repositories found.'}
              </li>
            ) : (
              filtered.map((repo: DiscoveredRepo) => (
                <RepoRow
                  key={repo.htmlUrl}
                  repo={repo}
                  registeredRepo={getRegisteredRepo(repo.htmlUrl)}
                  onSyncStarted={(id) => setSyncingRepoId(id)}
                />
              ))
            )}
          </ul>
        </>
      )}

      {/* Sync progress modal */}
      {syncingRepoId && (
        <SyncProgressModal
          repoId={syncingRepoId}
          repoName={
            registeredRepos.find((r: RepositoryInfo) => r.id === syncingRepoId)?.name ?? syncingRepoId
          }
          onClose={() => setSyncingRepoId(null)}
        />
      )}
    </div>
  );
}
