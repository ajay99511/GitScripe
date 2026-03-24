import { useEffect, useState } from 'react';
import type { SummaryInfo } from '../../lib/api';
import { api } from '../../lib/api';
import { toDisplayStatus, getPreselectedModel, type DisplayStatus } from '../../lib/displayStatus';

interface ResummarizePanelProps {
  repoId: string;
  selectableSummaries: SummaryInfo[];
  onComplete: () => void;
}

const STATUS_BADGE: Record<DisplayStatus, string> = {
  Summarized: 'text-[#3fb950] bg-[#1f3a2a]',
  Skipped: 'text-[#8b949e] bg-[#21262d]',
  Processing: 'text-[#58a6ff] bg-[#1f3a5f]',
  Queued: 'text-[#8b949e] bg-[#21262d]',
  Failed: 'text-[#f85149] bg-[#3d1f1f]',
};

export function ResummarizePanel({ repoId, selectableSummaries, onComplete }: ResummarizePanelProps) {
  const [selectedShas, setSelectedShas] = useState<Set<string>>(new Set());
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fetch available models on mount
  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);
    setModelsError(null);

    api.config.models()
      .then((data) => {
        if (cancelled) return;
        setAvailableModels(data.models);
        // Pre-select the most recently used model, or the system default
        const preselected = getPreselectedModel(selectableSummaries, data.default);
        setSelectedModel(preselected);
      })
      .catch((err) => {
        if (cancelled) return;
        setModelsError(err instanceof Error ? err.message : 'Failed to load models');
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectableSummaries]);

  const toggleSha = (sha: string) => {
    setSelectedShas((prev) => {
      const next = new Set(prev);
      if (next.has(sha)) {
        next.delete(sha);
      } else {
        next.add(sha);
      }
      return next;
    });
  };

  const selectAllFailed = () => {
    const failedShas = selectableSummaries
      .filter((s) => toDisplayStatus(s.status, s.isTrivial) === 'Failed')
      .map((s) => s.commitSha);
    setSelectedShas(new Set(failedShas));
  };

  const handleSubmit = async () => {
    if (selectedShas.size === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await api.summaries.resummarize(repoId, {
        shas: [...selectedShas],
        model: selectedModel,
      });
      onComplete();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Re-summarization failed');
      setIsSubmitting(false);
    }
  };

  const failedCount = selectableSummaries.filter(
    (s) => toDisplayStatus(s.status, s.isTrivial) === 'Failed'
  ).length;

  return (
    <div className="border border-[#30363d] rounded-lg p-3 space-y-3 bg-[#0d1117]">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#e6edf3] font-medium">Re-summarize commits</p>
        {failedCount > 0 && (
          <button
            onClick={selectAllFailed}
            className="text-xs text-[#58a6ff] hover:underline"
          >
            Select all failed ({failedCount})
          </button>
        )}
      </div>

      {/* Commit checklist */}
      <ul className="space-y-1 max-h-40 overflow-y-auto">
        {selectableSummaries.map((s) => {
          const ds = toDisplayStatus(s.status, s.isTrivial);
          const checked = selectedShas.has(s.commitSha);
          return (
            <li key={s.commitSha}>
              <label className="flex items-center gap-2 cursor-pointer hover:bg-[#21262d] rounded px-1.5 py-1 transition-colors">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSha(s.commitSha)}
                  className="accent-[#58a6ff] w-3.5 h-3.5 flex-shrink-0"
                />
                <code className="text-[#8b949e] font-mono text-xs flex-shrink-0">
                  {s.commitSha.slice(0, 8)}
                </code>
                <span className="text-[#8b949e] text-xs flex-shrink-0 truncate max-w-[120px]">
                  {s.authorName}
                </span>
                <span className={`text-xs px-1 py-0.5 rounded flex-shrink-0 ${STATUS_BADGE[ds]}`}>
                  {ds}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {/* Selection count */}
      {selectedShas.size > 0 && (
        <p className="text-xs text-[#8b949e]">
          {selectedShas.size} commit{selectedShas.size !== 1 ? 's' : ''} selected
        </p>
      )}

      {/* Model selector */}
      <div className="space-y-1">
        <label className="text-xs text-[#8b949e]" htmlFor="model-select">
          Model
        </label>
        {modelsLoading ? (
          <p className="text-xs text-[#8b949e]">Loading models…</p>
        ) : modelsError ? (
          <p className="text-xs text-[#f85149]">{modelsError}</p>
        ) : (
          <select
            id="model-select"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full bg-[#21262d] border border-[#30363d] text-[#e6edf3] text-xs rounded px-2 py-1.5 focus:outline-none focus:border-[#58a6ff]"
          >
            {availableModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Submit error */}
      {submitError && (
        <p className="text-xs text-[#f85149]">{submitError}</p>
      )}

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={selectedShas.size === 0 || isSubmitting || modelsLoading}
        className="w-full px-3 py-1.5 text-xs bg-[#1f3a5f] hover:bg-[#2d4f7c] text-[#58a6ff] rounded min-h-[36px] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
      >
        {isSubmitting ? (
          <>
            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Submitting…
          </>
        ) : (
          `Re-summarize${selectedShas.size > 0 ? ` (${selectedShas.size})` : ''}`
        )}
      </button>
    </div>
  );
}
