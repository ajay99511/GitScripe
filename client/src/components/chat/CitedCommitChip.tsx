import { useState } from 'react';
import type { CitedCommit } from '../../lib/api';

interface CitedCommitChipProps {
  commit: CitedCommit;
}

export function CitedCommitChip({ commit }: CitedCommitChipProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <span className="inline-block">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="inline-flex items-center gap-1 px-2 py-1 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded text-xs text-[#58a6ff] transition-colors min-h-[44px]"
      >
        <code className="font-mono">{commit.sha.slice(0, 8)}</code>
        <span className="text-[#8b949e] max-w-[120px] truncate">{commit.shortSummary}</span>
      </button>
      {expanded && (
        <div className="mt-1 p-2 bg-[#21262d] border border-[#30363d] rounded text-xs text-[#e6edf3]">
          <div className="flex items-center gap-2 mb-1">
            <code className="font-mono text-[#58a6ff]">{commit.sha.slice(0, 8)}</code>
            <a
              href={commit.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#58a6ff] hover:underline"
            >
              View ↗
            </a>
          </div>
          <p className="text-[#e6edf3]">{commit.shortSummary}</p>
        </div>
      )}
    </span>
  );
}
