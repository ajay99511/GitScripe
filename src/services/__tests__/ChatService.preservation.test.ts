/**
 * Preservation Property Tests — Task 2
 *
 * Property 2: Preservation — General Questions Use Semantic Search Only
 *
 * These tests capture the BASELINE behavior of ChatService.ask() for general
 * questions (no SHA / no date pattern). They MUST PASS on the UNFIXED code.
 *
 * After the fix is applied (task 3), these tests must STILL PASS — confirming
 * no regressions were introduced.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { ChatService } from '../ChatService.js';
import type { SummaryStore } from '../SummaryStore.js';
import type { SummaryInfo } from '../../models/types.js';

// ─── Helpers ─────────────────────────────────────────────

/** Build a minimal SummaryInfo stub */
function makeSummary(overrides: Partial<SummaryInfo> = {}): SummaryInfo & { similarity: number } {
  return {
    id: 'id-1',
    commitSha: 'aabbccdd',
    repoId: 'repo-uuid',
    shortSummary: 'A change',
    detailedSummary: 'Details',
    inferredIntent: 'Intent',
    fileSummaries: {},
    moduleSummaries: {},
    tags: [],
    riskLevel: 'low',
    qualityScore: 0.9,
    llmModel: 'test',
    processingMs: 100,
    status: 'done',
    errorMessage: null,
    createdAt: new Date('2024-01-01'),
    authorName: 'Dev',
    committedAt: new Date('2024-01-01'),
    htmlUrl: '',
    extractedConcepts: [],
    filesChanged: ['src/index.ts'],
    additions: 5,
    deletions: 2,
    similarity: 0.85,
    ...overrides,
  };
}

/** Build a mock SummaryStore with controllable return values */
function makeMockStore(semanticResults: (SummaryInfo & { similarity: number })[] = [makeSummary()]) {
  const store = {
    searchSemantic: vi.fn().mockResolvedValue(semanticResults),
    findBySha: vi.fn().mockResolvedValue(null),
    upsert: vi.fn(),
    markFailed: vi.fn(),
    getFileBiography: vi.fn(),
    listByRepo: vi.fn(),
    backfillMissingEmbeddings: vi.fn(),
  } as unknown as SummaryStore;
  return store;
}

/** Build a mock LLM chat model */
function makeMockLLM() {
  return {
    invoke: vi.fn().mockResolvedValue({ content: 'LLM answer' }),
  } as any;
}

// ─── SHA / date patterns (mirrors design.md) ─────────────

const SHA_PATTERN = /\b[0-9a-f]{7,40}\b/i;
const DATE_PATTERN =
  /\b\d{4}-\d{2}-\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2},? \d{4}\b/i;

function isGeneralQuestion(q: string): boolean {
  return !SHA_PATTERN.test(q) && !DATE_PATTERN.test(q);
}

// ─── Concrete Observation Tests ───────────────────────────

describe('ChatService — preservation: concrete general questions', () => {
  let store: SummaryStore;
  let llm: ReturnType<typeof makeMockLLM>;
  let service: ChatService;

  beforeEach(() => {
    store = makeMockStore();
    llm = makeMockLLM();
    service = new ChatService(llm, store);
  });

  it('ask("what changed last month?") calls searchSemantic and does NOT call findBySha', async () => {
    await service.ask('what changed last month?', 'repo-uuid');

    expect(store.searchSemantic).toHaveBeenCalledOnce();
    expect(store.findBySha).not.toHaveBeenCalled();
  });

  it('ask("when was authentication added?") calls searchSemantic and does NOT call findBySha', async () => {
    await service.ask('when was authentication added?', 'repo-uuid');

    expect(store.searchSemantic).toHaveBeenCalledOnce();
    expect(store.findBySha).not.toHaveBeenCalled();
  });

  it('ask("show me high-risk changes") calls searchSemantic and does NOT call findBySha', async () => {
    await service.ask('show me high-risk changes', 'repo-uuid');

    expect(store.searchSemantic).toHaveBeenCalledOnce();
    expect(store.findBySha).not.toHaveBeenCalled();
  });

  it('searchSemantic receives the repoId for general questions', async () => {
    const repoId = 'my-repo-id';
    await service.ask('what changed last month?', repoId);

    expect(store.searchSemantic).toHaveBeenCalledWith('what changed last month?', repoId, expect.any(Number));
  });

  it('returns fallback message when searchSemantic returns []', async () => {
    store = makeMockStore([]);
    service = new ChatService(llm, store);

    const result = await service.ask('what changed last month?', 'repo-uuid');

    expect(result.answer).toMatch(/no relevant commits|couldn't find/i);
    expect(store.findBySha).not.toHaveBeenCalled();
  });
});

// ─── Edge-case: short hex words must NOT trigger findBySha ─

describe('ChatService — preservation: short hex words (< 7 chars)', () => {
  const shortHexWords = ['cafe', 'dead', 'beef', 'face', 'bead', 'feed', 'bad', 'cab'];

  for (const word of shortHexWords) {
    it(`ask("the ${word} module was refactored") does NOT call findBySha`, async () => {
      const store = makeMockStore();
      const llm = makeMockLLM();
      const service = new ChatService(llm, store);

      await service.ask(`the ${word} module was refactored`, 'repo-uuid');

      expect(store.searchSemantic).toHaveBeenCalledOnce();
      expect(store.findBySha).not.toHaveBeenCalled();
    });
  }
});

// ─── Property-Based Test ──────────────────────────────────

describe('ChatService — preservation property: general questions never call findBySha', () => {
  /**
   * Property: For ALL question strings that do NOT match the SHA pattern
   * (/\b[0-9a-f]{7,40}\b/i) or the date pattern, ask() MUST:
   *   1. Call searchSemantic exactly once
   *   2. Never call findBySha
   *   3. Forward repoId to searchSemantic
   *
   * **Validates: Requirements 3.1, 3.2, 3.4**
   */
  it('property: general questions always use searchSemantic and never findBySha', async () => {
    // Arbitrary that generates question strings guaranteed to be "general"
    // (no 7+ char hex run, no ISO date, no month-name date)
    const generalQuestionArb = fc
      .array(
        // Words composed of characters that cannot form a hex run of 7+
        // Use printable ASCII excluding hex digits (a-f, A-F, 0-9) to be safe,
        // but allow common English letters g-z to form natural words.
        fc.stringMatching(/^[g-zG-Z !?,.']+$/).filter((s) => s.trim().length > 0),
        { minLength: 1, maxLength: 8 }
      )
      .map((words) => words.join(' '))
      .filter((q) => isGeneralQuestion(q) && q.trim().length > 0);

    await fc.assert(
      fc.asyncProperty(
        generalQuestionArb,
        fc.uuid(), // repoId
        async (question, repoId) => {
          const store = makeMockStore();
          const llm = makeMockLLM();
          const service = new ChatService(llm, store);

          await service.ask(question, repoId);

          // searchSemantic must be called exactly once
          expect(store.searchSemantic).toHaveBeenCalledOnce();
          // findBySha must never be called
          expect(store.findBySha).not.toHaveBeenCalled();
          // repoId must be forwarded
          expect(store.searchSemantic).toHaveBeenCalledWith(question, repoId, expect.any(Number));
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: When searchSemantic returns [] for any general question,
   * the fallback "no relevant commits" message is returned.
   *
   * **Validates: Requirement 3.3**
   */
  it('property: empty searchSemantic results always return fallback message', async () => {
    const generalQuestionArb = fc
      .array(
        fc.stringMatching(/^[g-zG-Z !?,.']+$/).filter((s) => s.trim().length > 0),
        { minLength: 1, maxLength: 8 }
      )
      .map((words) => words.join(' '))
      .filter((q) => isGeneralQuestion(q) && q.trim().length > 0);

    await fc.assert(
      fc.asyncProperty(generalQuestionArb, fc.uuid(), async (question, repoId) => {
        const store = makeMockStore([]); // always returns empty
        const llm = makeMockLLM();
        const service = new ChatService(llm, store);

        const result = await service.ask(question, repoId);

        expect(result.answer).toMatch(/no relevant commits|couldn't find/i);
        expect(store.findBySha).not.toHaveBeenCalled();
      }),
      { numRuns: 50 }
    );
  });
});
