import { useEffect, useState } from 'react';
import { useSyncProgress } from '../../hooks/useSyncProgress';
import { subscribeToRepo } from '../../lib/socket';
import { api } from '../../lib/api';

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

  // Auto-dismiss 2s after completion
  useEffect(() => {
    if (isDone) {
      const timer = setTimeout(onClose, 2000);
      return () => clearTimeout(timer);
    }
  }, [isDone, onClose]);

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const handleRetry = async () => {
    try {
      await api.repos.sync(repoId);
    } catch {
      // ignore — user can close and retry from RepoRow
    }
  };

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
          Syncing {repoName}
        </h2>

        {/* Progress bar */}
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

        {isError && (
          <div className="mb-4">
            <p className="text-sm text-[#f85149] mb-2">Sync encountered an error.</p>
            <button
              onClick={handleRetry}
              className="px-3 py-1.5 text-sm bg-[#3d1f1f] hover:bg-[#5a2a2a] text-[#f85149] rounded min-h-[44px] transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {isDone && (
          <p className="text-sm text-[#3fb950]">Sync complete! Closing…</p>
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
