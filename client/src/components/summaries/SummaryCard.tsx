import { useState } from 'react';
import type { SummaryInfo } from '../../lib/api';
import { RiskBadge } from './RiskBadge';

interface SummaryCardProps {
  summary: SummaryInfo;
}

export function SummaryCard({ summary }: SummaryCardProps) {
  const [expanded, setExpanded] = useState(false);

  const date = summary.committedAt
    ? new Date(summary.committedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '—';

  // Show a lightweight status row for non-done summaries
  if (summary.status !== 'done') {
    const statusLabel =
      summary.status === 'pending' ? 'Queued'
      : summary.status === 'processing' ? 'Processing…'
      : 'Failed';
    const statusColor =
      summary.status === 'failed' ? 'text-[#f85149]' : 'text-[#8b949e]';

    return (
      <article className="border border-[#30363d] rounded-lg bg-[#161b22] px-4 py-3 flex items-center justify-between gap-3">
        <code className="text-xs text-[#8b949e] font-mono bg-[#21262d] px-1.5 py-0.5 rounded flex-shrink-0">
          {summary.commitSha.slice(0, 8)}
        </code>
        <span className="text-[#8b949e] text-xs flex-1 truncate">{summary.shortSummary || 'Awaiting processing…'}</span>
        <span className={`text-xs flex-shrink-0 ${statusColor}`}>{statusLabel}</span>
      </article>
    );
  }

  return (
    <article className="border border-[#30363d] rounded-lg bg-[#161b22] overflow-hidden">
      {/* Summary header — always visible */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left px-4 py-3 hover:bg-[#21262d] transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-[#e6edf3] text-sm font-medium flex-1">{summary.shortSummary}</p>
          <span className="text-[#8b949e] text-xs flex-shrink-0 mt-0.5">{expanded ? '▲' : '▼'}</span>
        </div>

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="text-[#8b949e] text-xs">{summary.authorName}</span>
          <span className="text-[#30363d] text-xs">·</span>
          <span className="text-[#8b949e] text-xs">{date}</span>
          {(summary.additions > 0 || summary.deletions > 0) && (
            <>
              <span className="text-[#30363d] text-xs">·</span>
              <span className="text-xs text-[#3fb950]">+{summary.additions}</span>
              <span className="text-xs text-[#f85149]">-{summary.deletions}</span>
            </>
          )}
          <RiskBadge level={summary.riskLevel} />
          {summary.qualityScore != null && (
            <span className="text-xs text-[#8b949e]">
              Q: {(summary.qualityScore * 100).toFixed(0)}%
            </span>
          )}
        </div>

        {summary.tags.length > 0 && (
          <div className="flex gap-1 mt-2 flex-wrap">
            {summary.tags.map((tag) => (
              <span key={tag} className="text-xs bg-[#21262d] text-[#8b949e] px-1.5 py-0.5 rounded">
                {tag}
              </span>
            ))}
          </div>
        )}
      </button>

      {/* Expanded details */}
      <div
        className="overflow-hidden transition-all duration-300"
        style={{ maxHeight: expanded ? '2000px' : '0px' }}
      >
        <div className="px-4 pb-4 border-t border-[#30363d] pt-3 space-y-3">
          {/* SHA + GitHub link */}
          <div className="flex items-center gap-2">
            <code className="text-xs text-[#8b949e] font-mono bg-[#21262d] px-1.5 py-0.5 rounded">
              {summary.commitSha.slice(0, 8)}
            </code>
            <a
              href={summary.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#58a6ff] hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              View on GitHub ↗
            </a>
          </div>

          {/* Detailed summary */}
          <div>
            <p className="text-xs text-[#8b949e] uppercase tracking-wider mb-1">Detailed Summary</p>
            <p className="text-sm text-[#e6edf3]">{summary.detailedSummary}</p>
          </div>

          {/* Inferred intent */}
          <div>
            <p className="text-xs text-[#8b949e] uppercase tracking-wider mb-1">Inferred Intent</p>
            <p className="text-sm text-[#e6edf3]">{summary.inferredIntent}</p>
          </div>

          {/* Per-file summaries — prefer fileSummaries (AI descriptions), fall back to raw filesChanged */}
          {Object.keys(summary.fileSummaries).length > 0 ? (
            <div>
              <p className="text-xs text-[#8b949e] uppercase tracking-wider mb-1">Files Changed</p>
              <ul className="space-y-1">
                {Object.entries(summary.fileSummaries).map(([file, desc]) => (
                  <li key={file} className="text-xs">
                    <code className="text-[#8b949e] font-mono">{file}</code>
                    <span className="text-[#e6edf3] ml-2">{desc}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : summary.filesChanged.length > 0 ? (
            <div>
              <p className="text-xs text-[#8b949e] uppercase tracking-wider mb-1">
                Files Changed
                {(summary.additions > 0 || summary.deletions > 0) && (
                  <span className="ml-2 normal-case font-normal">
                    <span className="text-[#3fb950]">+{summary.additions}</span>
                    <span className="text-[#f85149] ml-1">-{summary.deletions}</span>
                  </span>
                )}
              </p>
              <ul className="space-y-0.5">
                {summary.filesChanged.map((file) => (
                  <li key={file}>
                    <code className="text-xs text-[#8b949e] font-mono">{file}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Concepts */}
          {summary.extractedConcepts.length > 0 && (
            <div>
              <p className="text-xs text-[#8b949e] uppercase tracking-wider mb-1">Concepts</p>
              <div className="flex gap-1 flex-wrap">
                {summary.extractedConcepts.map((c) => (
                  <span key={c} className="text-xs bg-[#21262d] text-[#58a6ff] px-1.5 py-0.5 rounded">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
