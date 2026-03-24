import { useEffect, useState } from 'react';
import type { SummaryInfo } from '../../lib/api';
import {
  toDisplayStatus,
  groupByDisplayStatus,
  isSelectable,
  type DisplayStatus,
} from '../../lib/displayStatus';
import { getSocket, subscribeToRepo } from '../../lib/socket';
import { ResummarizePanel } from './ResummarizePanel';

interface SummaryUpdatedEvent {
  repoId: string;
  commitSha: string;
  status: 'done' | 'failed' | 'processing';
  isTrivial?: boolean;
  errorMessage?: string;
}

interface SyncResultsViewProps {
  repoId: string;
  summaries: SummaryInfo[];
  onClose: () => void;
}

// Color coding per DisplayStatus
const STATUS_COLORS: Record<DisplayStatus, string> = {
  Summarized: 'text-[#3fb950] bg-[#1f3a2a]',
  Skipped: 'text-[#8b949e] bg-[#21262d]',
  Processing: 'text-[#58a6ff] bg-[#1f3a5f]',
  Queued: 'text-[#8b949e] bg-[#21262d]',
  Failed: 'text-[#f85149] bg-[#3d1f1f]',
};

// Display order for groups
const GROUP_ORDER: DisplayStatus[] = ['Failed', 'Queued', 'Processing', 'Summarized', 'Skipped'];

export function SyncResultsView({ repoId, summaries: initialSummaries, onClose }: SyncResultsViewProps) {
  const [localSummaries, setLocalSummaries] = useState<SummaryInfo[]>(initialSummaries);

  // Subscribe to repo room and listen for real-time summary updates
  useEffect(() => {
    subscribeToRepo(repoId);
    const socket = getSocket();

    const handleUpdate = (event: SummaryUpdatedEvent) => {
      if (event.repoId !== repoId) return;
      setLocalSummaries((prev) =>
        prev.map((s) =>
          s.commitSha === event.commitSha
            ? {
                ...s,
                status: event.status,
                isTrivial: event.isTrivial ?? s.isTrivial,
                errorMessage: event.errorMessage ?? null,
              }
            : s
        )
      );
    };

    socket.on('summary:updated', handleUpdate);
    return () => {
      socket.off('summary:updated', handleUpdate);
    };
  }, [repoId]);

  const groups = groupByDisplayStatus(localSummaries);

  const inProgressCount = localSummaries.filter((s) => {
    const ds = toDisplayStatus(s.status, s.isTrivial);
    return ds === 'Processing' || ds === 'Queued';
  }).length;

  const selectableSummaries = localSummaries.filter((s) =>
    isSelectable(toDisplayStatus(s.status, s.isTrivial))
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[#e6edf3] text-sm font-semibold">Sync Results</h3>
        {inProgressCount > 0 && (
          <span className="text-xs text-[#58a6ff] flex items-center gap-1">
            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            {inProgressCount} remaining
          </span>
        )}
      </div>

      {/* Groups */}
      <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
        {GROUP_ORDER.map((displayStatus) => {
          const items = groups.get(displayStatus);
          if (!items || items.length === 0) return null;

          return (
            <div key={displayStatus}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${STATUS_COLORS[displayStatus]}`}>
                  {displayStatus}
                </span>
                <span className="text-xs text-[#8b949e]">{items.length}</span>
              </div>
              <ul className="space-y-1">
                {items.map((s) => (
                  <li
                    key={s.commitSha}
                    className="flex items-start gap-2 text-xs bg-[#21262d] rounded px-2 py-1.5"
                  >
                    <code className="text-[#8b949e] font-mono flex-shrink-0">
                      {s.commitSha.slice(0, 8)}
                    </code>
                    <span className="text-[#8b949e] flex-shrink-0">{s.authorName}</span>
                    {displayStatus === 'Failed' && s.errorMessage && (
                      <span className="text-[#f85149] truncate flex-1" title={s.errorMessage}>
                        {s.errorMessage}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Re-summarize panel — only shown when there are selectable commits */}
      {selectableSummaries.length > 0 && (
        <ResummarizePanel
          repoId={repoId}
          selectableSummaries={selectableSummaries}
          onComplete={onClose}
        />
      )}
    </div>
  );
}
