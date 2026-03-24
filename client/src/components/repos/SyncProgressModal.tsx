import { useEffect, useState } from 'react';
import { useSyncProgress } from '../../hooks/useSyncProgress';
import { useSummaries } from '../../hooks/useSummaries';
import { subscribeToRepo } from '../../lib/socket';
import { shouldAutoDismiss } from '../../lib/displayStatus';
import { SyncResultsView } from './SyncResultsView';

interface SyncProgressModalProps {
  repoId: string;
  repoName: string;
  onClose: () => void;
}

export function SyncProgressModal({ repoId, repoName, onClose }: SyncProgressModalProps) {
  const [elapsed, setElapsed] = useState(0);
  const [startTime] = useState(Date.now());
  const { data } = useSyncProgress(repoId);

  const repo = data?.repo;
  const progress = data?.progress;
  const total = progress?.total ?? 0;
  const processed = progress?.processed ?? 0;
  const failed = progress?.failed ?? 0;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const isDone = repo?.status === 'idle' && total > 0 && processed + failed >= total;
  const isError = repo?.status === 'error';

  // Fetch summaries once sync is done to determine auto-dismiss vs results view
  const { data: summariesData, isLoading: summariesLoading } = useSummaries(
    isDone ? repoId : null,
    { limit: 200 }
  );
  const summaries = summariesData?.summaries ?? [];

  // Subscribe to Socket.io updates for this repo
  useEffect(() => {
    subscribeToRepo(repoId);
  }, [repoId]);

  // Elapsed timer — ticks every second
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  // Auto-dismiss 2s after completion — only when all commits are Summarized or Skipped
  useEffect(() => {
    if (isDone && summaries.length > 0 && shouldAutoDismiss(summaries)) {
      const timer = setTimeout(onClose, 2000);
      return () => clearTimeout(timer);
    }
  }, [isDone, summaries, onClose]);

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  // Determine what to show in the modal body
  const showResults = isDone && !summariesLoading && summaries.length > 0 && !shouldAutoDismiss(summaries);
  const showAutoClose = isDone && !summariesLoading && summaries.length > 0 && shouldAutoDismiss(summaries);
  const showLoadingResults = isDone && summariesLoading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal panel */}
      <div className="relative bg-[#161b22] border border-[#30363d] rounded-lg p-6 w-full max-w-md mx-4 shadow-xl">
        <h2 className="text-[#e6edf3] font-semibold mb-4">
          {isDone ? `Sync complete — ${repoName}` : `Syncing ${repoName}`}
        </h2>

        {/* Progress bar — hidden once we show results */}
        {!showResults && (
          <>
            <div className="w-full bg-[#21262d] rounded-full h-2 mb-3">
              <div
                className="bg-[#58a6ff] h-2 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="flex justify-between text-sm text-[#8b949e] mb-2">
              <span>{processed} / {total} commits</span>
              <span>{pct}%</span>
            </div>

            {failed > 0 && (
              <p className="text-xs text-[#f85149] mb-2">{failed} failed</p>
            )}

            <p className="text-xs text-[#8b949e] mb-4">Elapsed: {formatElapsed(elapsed)}</p>
          </>
        )}

        {/* Error state */}
        {isError && (
          <div className="mb-4">
            <p className="text-sm text-[#f85149] mb-2">Sync encountered an error.</p>
          </div>
        )}

        {/* Loading results spinner */}
        {showLoadingResults && (
          <p className="text-sm text-[#8b949e] flex items-center gap-2">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading results…
          </p>
        )}

        {/* Auto-close message */}
        {showAutoClose && (
          <p className="text-sm text-[#3fb950]">All commits summarized. Closing…</p>
        )}

        {/* Sync results view with re-summarize panel */}
        {showResults && (
          <SyncResultsView
            repoId={repoId}
            summaries={summaries}
            onClose={onClose}
          />
        )}

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#8b949e] hover:text-[#e6edf3] min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
