/**
 * Bug Condition Exploration Tests — Task 1
 *
 * Property 1: Bug Condition — Direct Lookup Not Performed for SHA/Date Questions
 *
 * These tests encode the EXPECTED behavior after the fix:
 * - When a question contains a SHA, findBySha MUST be called
 * - When a question contains a date, a date-range query MUST be performed
 * - The LLM prompt MUST contain a Files: line
 *
 * On UNFIXED code these tests FAIL (confirming the bug).
 * After the fix (task 3) these tests PASS (confirming the fix).
 *
 * **Validates: Requirements 1.1, 1.3, 2.1, 2.2, 2.4**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from '../ChatService.js';
import type { SummaryStore } from '../SummaryStore.js';
import type { SummaryInfo } from '../../models/types.js';

// ─── Helpers ─────────────────────────────────────────────

function makeSummary(overrides: Partial<SummaryInfo> = {}): SummaryInfo & { similarity: number } {
  return {
    id: 'id-1',
    commitSha: 'dc387a9abcd1234',
    repoId: 'repo-uuid',
    shortSummary: 'Real commit summary',
    detailedSummary: 'Real detailed summary',
    inferredIntent: 'Real intent',
    fileSummaries: {},
    moduleSummaries: {},
    tags: ['cpp', 'scheduling'],
    riskLevel: 'low',
    qualityScore: 0.9,
    llmModel: 'test',
    processingMs: 100,
    status: 'done',
    errorMessage: null,
    createdAt: new Date('2020-10-26'),
    authorName: 'Dev',
    committedAt: new Date('2020-10-26'),
    htmlUrl: '',
    extractedConcepts: [],
    filesChanged: ['src/experiment/scheduler.cpp', 'src/experiment/algo.h'],
    additions: 50,
    deletions: 10,
    similarity: 1.0,
    ...overrides,
  };
}

function makeMockStore(
  shaResult: (SummaryInfo & { similarity: number }) | null = makeSummary(),
  semanticResults: (SummaryInfo & { similarity: number })[] = [makeSummary()]
) {
  return {
    searchSemantic: vi.fn().mockResolvedValue(semanticResults),
    findBySha: vi.fn().mockResolvedValue(shaResult),
    findByDateRange: vi.fn().mockResolvedValue(shaResult ? [shaResult] : []),
    upsert: vi.fn(),
    markFailed: vi.fn(),
    getFileBiography: vi.fn(),
    listByRepo: vi.fn(),
    backfillMissingEmbeddings: vi.fn(),
  } as unknown as SummaryStore;
}

function makeMockLLM() {
  // Capture the last prompt so we can inspect it
  const invoke = vi.fn().mockResolvedValue({ content: 'LLM answer' });
  return { invoke };
}

// ─── Tests ────────────────────────────────────────────────

describe('ChatService — bug condition: SHA in question triggers findBySha', () => {
  it('Test 1: ask("what was in commit dc387a9?") calls findBySha with "dc387a9"', async () => {
    const store = makeMockStore();
    const llm = makeMockLLM();
    const service = new ChatService(llm as any, store);

    await service.ask('what was in commit dc387a9?', 'repo-uuid');

    expect(store.findBySha).toHaveBeenCalledWith('dc387a9');
  });

  it('Test 3: ask("tell me about abc1234 and the auth refactor") calls findBySha with "abc1234"', async () => {
    const store = makeMockStore();
    const llm = makeMockLLM();
    const service = new ChatService(llm as any, store);

    await service.ask('tell me about abc1234 and the auth refactor', 'repo-uuid');

    expect(store.findBySha).toHaveBeenCalledWith('abc1234');
  });
});

describe('ChatService — bug condition: date in question triggers date-range query', () => {
  it('Test 2: ask("what changed on 2020-10-26?") calls findByDateRange', async () => {
    const store = makeMockStore();
    const llm = makeMockLLM();
    const service = new ChatService(llm as any, store);

    await service.ask('what changed on 2020-10-26?', 'repo-uuid');

    expect(store.findByDateRange).toHaveBeenCalled();
    // Verify the date range covers 2020-10-26
    const [start, end] = (store.findByDateRange as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(start).toBeInstanceOf(Date);
    expect(end).toBeInstanceOf(Date);
    expect(end.getTime() - start.getTime()).toBe(86400000); // exactly 1 day
  });
});

describe('ChatService — bug condition: LLM prompt contains Files: line', () => {
  it('Test 4: ask("tell me about abc1234") passes Files: line to LLM', async () => {
    const store = makeMockStore(
      makeSummary({ commitSha: 'abc1234', filesChanged: ['src/experiment/scheduler.cpp'] })
    );
    const llm = makeMockLLM();
    const service = new ChatService(llm as any, store);

    await service.ask('tell me about abc1234', undefined);

    expect(llm.invoke).toHaveBeenCalled();
    const messages = llm.invoke.mock.calls[0][0];
    // The HumanMessage content should contain "Files:"
    const humanMsg = messages.find((m: any) => m.constructor?.name === 'HumanMessage' || m._getType?.() === 'human');
    const content = humanMsg?.content ?? '';
    expect(content).toMatch(/Files:/);
  });
});
