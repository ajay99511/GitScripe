import type { SummaryInfo } from './api';

// ─── DisplayStatus ────────────────────────────────────────────────────────────
// User-facing labels that map from DB SummaryStatus + isTrivial flag.

export type DisplayStatus = 'Summarized' | 'Skipped' | 'Processing' | 'Queued' | 'Failed';

/**
 * Map a DB summary status + isTrivial flag to a user-facing DisplayStatus label.
 *
 * Mapping:
 *   done  + isTrivial=false → Summarized
 *   done  + isTrivial=true  → Skipped
 *   processing              → Processing
 *   pending                 → Queued
 *   failed                  → Failed
 */
export function toDisplayStatus(status: string, isTrivial: boolean): DisplayStatus {
  if (status === 'done') return isTrivial ? 'Skipped' : 'Summarized';
  if (status === 'processing') return 'Processing';
  if (status === 'pending') return 'Queued';
  return 'Failed';
}

/**
 * Returns true iff the modal should auto-dismiss:
 * the list is non-empty and every summary is Summarized or Skipped.
 */
export function shouldAutoDismiss(summaries: SummaryInfo[]): boolean {
  if (summaries.length === 0) return false;
  return summaries.every((s) => {
    const ds = toDisplayStatus(s.status, s.isTrivial);
    return ds === 'Summarized' || ds === 'Skipped';
  });
}

/**
 * Returns true iff a commit with this DisplayStatus can be selected for re-summarization.
 * Only Failed and Skipped commits are selectable.
 */
export function isSelectable(status: DisplayStatus): boolean {
  return status === 'Failed' || status === 'Skipped';
}

/**
 * Returns the LLM model to pre-select in the ResummarizePanel.
 * Uses the llmModel of the most recently committed done summary,
 * falling back to defaultModel when no done summary exists.
 */
export function getPreselectedModel(summaries: SummaryInfo[], defaultModel: string): string {
  const doneSummaries = summaries.filter((s) => s.status === 'done' && s.llmModel);
  if (doneSummaries.length === 0) return defaultModel;

  // Sort by committedAt descending — most recent first
  const sorted = [...doneSummaries].sort(
    (a, b) => new Date(b.committedAt).getTime() - new Date(a.committedAt).getTime()
  );

  return sorted[0]!.llmModel ?? defaultModel;
}

/**
 * Group summaries by DisplayStatus.
 * Returns a map of DisplayStatus → SummaryInfo[].
 */
export function groupByDisplayStatus(
  summaries: SummaryInfo[]
): Map<DisplayStatus, SummaryInfo[]> {
  const groups = new Map<DisplayStatus, SummaryInfo[]>();
  for (const s of summaries) {
    const ds = toDisplayStatus(s.status, s.isTrivial);
    const existing = groups.get(ds) ?? [];
    existing.push(s);
    groups.set(ds, existing);
  }
  return groups;
}
