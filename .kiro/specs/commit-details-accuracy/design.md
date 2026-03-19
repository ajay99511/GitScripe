# Commit Details Accuracy Bugfix Design

## Overview

`ChatService.ask()` routes every question through semantic vector search over pre-generated summaries. When a user asks about a specific commit by SHA or date, the system never performs a direct DB lookup — it relies entirely on embedding similarity. If the stored summary was hallucinated (generated from a bad or missing diff), the LLM receives and faithfully repeats that hallucinated content.

The fix adds a pre-search detection step: parse the question for SHA patterns (hex strings ≥ 7 chars) or date references, perform a direct `findBySha` / date-range lookup first, and inject the real commit data — including `filesChanged` — as primary context before any semantic results.

## Glossary

- **Bug_Condition (C)**: The question contains a specific commit reference (SHA or date) AND the system does not perform a direct DB lookup before passing context to the LLM
- **Property (P)**: When a specific commit is referenced, the fixed `ask()` SHALL perform a direct lookup and include the real commit data (including `filesChanged`) as primary context
- **Preservation**: General/topic questions that do NOT reference a specific commit must continue to use semantic search exclusively, with all existing scoping and fallback behavior unchanged
- **ChatService.ask()**: The method in `src/services/ChatService.ts` that retrieves context and generates a cited answer
- **SummaryStore.findBySha()**: Direct lookup by commit SHA in `src/services/SummaryStore.ts`
- **SummaryStore.searchSemantic()**: Vector similarity search over stored summary embeddings
- **isBugCondition**: The predicate that identifies questions containing a specific commit reference
- **filesChanged**: JSONB array on the `commits` table listing all file paths touched by a commit

## Bug Details

### Bug Condition

The bug manifests when a user asks about a specific commit by SHA or date. `ChatService.ask()` has no detection logic for specific commit references — it always calls `searchSemantic()` and never calls `findBySha()`. If the stored summary is hallucinated, the LLM repeats it verbatim.

**Formal Specification:**
```
FUNCTION isBugCondition(question)
  INPUT: question of type string
  OUTPUT: boolean

  shaPattern   := /\b[0-9a-f]{7,40}\b/i
  datePattern  := /\b\d{4}-\d{2}-\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2},? \d{4}\b/i

  RETURN (shaPattern.test(question) OR datePattern.test(question))
         AND directLookupWasNotPerformed(question)
END FUNCTION
```

### Examples

- User asks "what was in commit dc387a9?" → system returns hallucinated "EnGram Progress Guide" content instead of the real C++ scheduling files under `src/experiment/`
- User asks "what changed on Oct 26, 2020?" → system returns semantically similar but unrelated summaries instead of the commits from that date
- User asks "tell me about abc1234 and the auth refactor" → system ignores the SHA and returns only semantic matches for "auth refactor"
- User asks "what is commit 0000000?" (SHA not in DB) → system should fall back to semantic search gracefully

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- General questions without SHA/date references (e.g., "what changed last month?") must continue to use semantic vector search exclusively
- Topic/concept questions (e.g., "when was authentication added?") must continue to return semantically ranked results
- The "no relevant commits" fallback message must still be returned when no results are found
- `repoId` scoping must be applied to all queries — both direct lookups and semantic search — when provided

**Scope:**
All questions that do NOT match the SHA or date pattern (isBugCondition returns false) must be completely unaffected by this fix. This includes:
- Free-form natural language questions about topics or concepts
- Questions about authors, tags, or risk levels
- Questions with no temporal or SHA specificity

## Hypothesized Root Cause

Based on the bug description and code review of `ChatService.ask()`:

1. **No commit reference detection**: `ask()` has no regex or parsing logic to identify SHA patterns or date references in the question string. Every question is treated identically.

2. **Exclusive reliance on embedding similarity**: The only retrieval path is `this.summaryStore.searchSemantic(question, repoId, limit)`. There is no branch for direct lookup.

3. **filesChanged absent from LLM context**: The context string built in `ask()` includes `shortSummary`, `detailedSummary`, `inferredIntent`, `tags`, and `riskLevel` — but not `filesChanged`. The LLM cannot cross-check its answer against actual file paths.

4. **Hallucinated summaries propagate silently**: `SummaryStore.upsert()` stores whatever the LLM generated during pipeline processing. If the diff was empty or malformed, the stored summary may be entirely fabricated, and there is no flag or warning surfaced to the chat LLM.

## Correctness Properties

Property 1: Bug Condition - Direct Lookup for Specific Commit References

_For any_ question where `isBugCondition` returns true (question contains a SHA or date pattern), the fixed `ChatService.ask()` SHALL perform a direct DB lookup (via `findBySha` or date-range query) before falling back to semantic search, and SHALL include the directly-retrieved summary — with its `filesChanged` list — as the primary context passed to the LLM.

**Validates: Requirements 2.1, 2.2, 2.4**

Property 2: Preservation - General Questions Use Semantic Search Only

_For any_ question where `isBugCondition` returns false (no SHA or date pattern), the fixed `ChatService.ask()` SHALL produce the same retrieval behavior as the original function — calling `searchSemantic()` and NOT calling `findBySha()` — preserving all existing ranking, scoping, and fallback behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/services/ChatService.ts`

**Function**: `ChatService.ask()`

**Specific Changes**:

1. **Add commit reference detection**: Implement `extractCommitRef(question: string)` that returns `{ type: 'sha', value: string } | { type: 'date', value: string } | null` using regex patterns for hex SHAs (7–40 chars) and common date formats.

2. **Add direct SHA lookup path**: Before calling `searchSemantic()`, if `extractCommitRef` returns a SHA match, call `this.summaryStore.findBySha(sha)`. If a result is returned, use it as the primary context item.

3. **Add date-range lookup to SummaryStore**: Add `findByDateRange(start: Date, end: Date, repoId?: string): Promise<SummaryInfo[]>` to `SummaryStore` that queries the `commits` table by `committedAt` range and joins summaries.

4. **Include filesChanged in LLM context**: Update the context-building map in `ask()` to append `Files: ${s.filesChanged.join(', ')}` to each context block. This applies to both direct-lookup and semantic-search results.

5. **Graceful fallback**: If the direct lookup returns null (SHA not in DB), fall through to `searchSemantic()` as before, so no regression occurs for unknown SHAs.

**File**: `src/services/SummaryStore.ts`

**Specific Changes**:

6. **Add findByDateRange method**: Query `commits` joined to `summaries` where `committedAt` falls within the date range and `repoId` matches (if provided). Return `SummaryInfo[]`.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that call `ChatService.ask()` with SHA-containing questions and assert that `SummaryStore.findBySha` is called. Run these tests on the UNFIXED code to observe failures and confirm the root cause.

**Test Cases**:
1. **SHA in question — no direct lookup**: Call `ask("what was in commit dc387a9?", repoId)`, assert `findBySha` was called with `"dc387a9"` (will fail on unfixed code)
2. **Date in question — no date lookup**: Call `ask("what changed on 2020-10-26?", repoId)`, assert a date-range query was performed (will fail on unfixed code)
3. **filesChanged absent from context**: Call `ask("tell me about abc1234")`, assert the LLM prompt contains `Files:` line (will fail on unfixed code)
4. **Hallucinated summary propagates**: Seed a summary with fabricated content, call `ask()` with its SHA, assert the answer does not contain the fabricated content (may fail on unfixed code)

**Expected Counterexamples**:
- `findBySha` is never called regardless of question content
- The context string never contains `Files:` entries
- Possible causes: no detection logic, no direct lookup branch, no filesChanged in context builder

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL question WHERE isBugCondition(question) DO
  result := ChatService_fixed.ask(question, repoId)
  ASSERT findBySha was called with the extracted SHA
  ASSERT result context includes filesChanged
  ASSERT answer is grounded in the directly-retrieved summary
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL question WHERE NOT isBugCondition(question) DO
  ASSERT ChatService_original.ask(question, repoId) behavior
       = ChatService_fixed.ask(question, repoId) behavior
  -- i.e., searchSemantic called, findBySha NOT called
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many question strings automatically, covering the full space of non-SHA/non-date inputs
- It catches edge cases like questions that contain hex-like words that are not SHAs (e.g., "cafe", "dead")
- It provides strong guarantees that semantic search behavior is unchanged for all general questions

**Test Plan**: Observe behavior on UNFIXED code for general questions, then write property-based tests capturing that behavior.

**Test Cases**:
1. **General question preservation**: Verify `searchSemantic` is called and `findBySha` is NOT called for questions without SHA/date patterns
2. **repoId scoping preservation**: Verify `repoId` is passed through to all queries (both direct and semantic) when provided
3. **No-results fallback preservation**: Verify the fallback message is returned when both direct lookup and semantic search return empty results
4. **Short hex word false-positive guard**: Verify words like "cafe", "dead", "beef" (< 7 chars or common words) do not trigger the direct lookup path

### Unit Tests

- Test `extractCommitRef()` with valid SHAs (7-char, 8-char, 40-char), date strings, mixed questions, and non-matching questions
- Test `ask()` with a mocked `SummaryStore` — assert call routing based on question content
- Test context builder includes `filesChanged` for both direct-lookup and semantic results

### Property-Based Tests

- Generate random alphanumeric strings of length 1–6 and verify they do NOT trigger `isBugCondition` (too short to be a SHA)
- Generate random valid hex strings of length 7–40 embedded in question templates and verify they DO trigger `isBugCondition`
- Generate random non-SHA question strings and verify `ask()` calls `searchSemantic` and not `findBySha` (preservation property)
- Generate random `repoId` values and verify all DB calls include the scoping filter

### Integration Tests

- End-to-end: seed a commit + summary in the test DB, call `ask()` with the SHA, verify the answer references the real `filesChanged` paths
- End-to-end: seed two commits, ask about one by SHA, verify the other commit's data does not appear as primary context
- End-to-end: ask a general question, verify semantic search is used and results are ranked by similarity
