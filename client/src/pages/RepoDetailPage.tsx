import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { RepositoryInfo, SummaryInfo } from '../lib/api';
import { useRepos } from '../hooks/useRepos';
import { useSummaries } from '../hooks/useSummaries';
import { SummaryCard } from '../components/summaries/SummaryCard';
import { SummaryFilters } from '../components/summaries/SummaryFilters';
import { ChatPanel } from '../components/chat/ChatPanel';

const PAGE_SIZE = 20;

export function RepoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: reposData } = useRepos();
  const repo = reposData?.repos.find((r: RepositoryInfo) => r.id === id);

  const [riskLevel, setRiskLevel] = useState('');
  const [tag, setTag] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useSummaries(id ?? null, {
    page,
    limit: PAGE_SIZE,
    riskLevel: riskLevel || undefined,
    tag: tag || undefined,
  });

  const summaries: SummaryInfo[] = data?.summaries ?? [];
  const total = data?.pagination.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const availableTags: string[] = [...new Set(summaries.flatMap((s: SummaryInfo) => s.tags))];

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Summaries panel — 60% */}
      <div className="flex-1 md:w-3/5 overflow-y-auto p-4">
        <div className="mb-4">
          <h1 className="text-[#e6edf3] text-lg font-semibold mb-3">
            {repo ? `${repo.owner}/${repo.name}` : 'Repository'}
          </h1>
          <SummaryFilters
            riskLevel={riskLevel}
            tag={tag}
            availableTags={availableTags}
            onRiskLevelChange={(v) => { setRiskLevel(v); setPage(1); }}
            onTagChange={(v) => { setTag(v); setPage(1); }}
          />
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <ul className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <li key={i} className="h-20 bg-[#161b22] rounded animate-pulse border border-[#30363d]" />
            ))}
          </ul>
        )}

        {/* Empty state */}
        {!isLoading && summaries.length === 0 && (
          <p className="text-[#8b949e] text-sm text-center mt-8">
            No summaries yet. Click "Sync Now" on the Discover page to start processing commits.
          </p>
        )}

        {/* Summary list + pagination */}
        {!isLoading && summaries.length > 0 && (
          <>
            <ul className="space-y-2">
              {summaries.map((s: SummaryInfo) => (
                <li key={s.id}>
                  <SummaryCard summary={s} />
                </li>
              ))}
            </ul>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <button
                  onClick={() => setPage((p: number) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] rounded min-h-[44px] disabled:opacity-50 transition-colors"
                >
                  Previous
                </button>
                <span className="text-[#8b949e] text-sm">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 text-sm bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] rounded min-h-[44px] disabled:opacity-50 transition-colors"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Chat panel — 40%, sticky on desktop */}
      <div className="md:w-2/5 md:sticky md:top-0 md:h-screen border-t md:border-t-0 border-[#30363d]">
        <ChatPanel
          repoId={id ?? ''}
          repoName={repo ? `${repo.owner}/${repo.name}` : 'Repository'}
        />
      </div>
    </div>
  );
}
