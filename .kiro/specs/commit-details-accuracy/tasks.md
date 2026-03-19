# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Direct Lookup Not Performed for SHA/Date Questions
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate `ChatService.ask()` never calls `findBySha` even when the question contains a SHA or date pattern
  - **Scoped PBT Approach**: Scope the property to concrete failing cases — questions containing a 7-char hex SHA (e.g., "dc387a9") and questions containing an ISO date (e.g., "2020-10-26")
  - Mock `SummaryStore` and spy on `findBySha` and `searchSemantic`
  - Test 1: Call `ask("what was in commit dc387a9?", repoId)` — assert `findBySha` was called with `"dc387a9"` (isBugCondition: shaPattern matches "dc387a9")
  - Test 2: Call `ask("what changed on 2020-10-26?", repoId)` — assert a date-range query was performed (isBugCondition: datePattern matches "2020-10-26")
  - Test 3: Call `ask("tell me about abc1234 and the auth refactor", repoId)` — assert `findBySha` was called with `"abc1234"`
  - Test 4: Call `ask("tell me about abc1234")` — assert the LLM prompt passed to the model contains a `Files:` line
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (proves the bug exists — `findBySha` is never called, `Files:` never appears in context)
  - Document counterexamples found (e.g., "`findBySha` call count = 0 for question containing SHA")
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - General Questions Use Semantic Search Only
  - **IMPORTANT**: Follow observation-first methodology
  - Observe: `ask("what changed last month?", repoId)` calls `searchSemantic` and does NOT call `findBySha` on unfixed code
  - Observe: `ask("when was authentication added?", repoId)` calls `searchSemantic` and does NOT call `findBySha` on unfixed code
  - Observe: `ask("show me high-risk changes", repoId)` calls `searchSemantic` and does NOT call `findBySha` on unfixed code
  - Observe: when `searchSemantic` returns `[]`, the fallback "no relevant commits" message is returned
  - Write property-based test: for all question strings that do NOT match `/\b[0-9a-f]{7,40}\b/i` or the date pattern, `ask()` calls `searchSemantic` and never calls `findBySha` (from Preservation Requirements in design)
  - Include edge-case inputs: short hex words like "cafe", "dead", "beef" (< 7 chars) must NOT trigger `findBySha`
  - Include repoId scoping: verify `repoId` is forwarded to `searchSemantic` for all general questions
  - Verify tests PASS on UNFIXED code (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix for commit-details-accuracy — direct lookup for SHA/date questions

  - [x] 3.1 Implement `extractCommitRef()` in `ChatService`
    - Add `extractCommitRef(question: string): { type: 'sha', value: string } | { type: 'date', value: string } | null`
    - SHA pattern: `/\b[0-9a-f]{7,40}\b/i` — return first match as `{ type: 'sha', value: match }`
    - Date pattern: `/\b\d{4}-\d{2}-\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2},? \d{4}\b/i` — return first match as `{ type: 'date', value: match }`
    - Return `null` if neither pattern matches
    - _Bug_Condition: isBugCondition(question) where shaPattern.test(question) OR datePattern.test(question)_
    - _Requirements: 2.1_

  - [x] 3.2 Add direct SHA lookup path in `ChatService.ask()`
    - Before calling `searchSemantic()`, call `extractCommitRef(question)`
    - If result is `{ type: 'sha' }`, call `this.summaryStore.findBySha(value)` scoped by `repoId` if provided
    - If `findBySha` returns a result, prepend it to the `relevant` array as the primary context item (or use it exclusively)
    - If `findBySha` returns `null`, fall through to `searchSemantic()` unchanged (graceful fallback for unknown SHAs)
    - If result is `{ type: 'date' }`, call `this.summaryStore.findByDateRange(start, end, repoId)` and prepend results
    - _Bug_Condition: isBugCondition(question) — directLookupWasNotPerformed(question) is now false after this change_
    - _Expected_Behavior: findBySha called with extracted SHA; date-range query performed for date references_
    - _Preservation: questions where extractCommitRef returns null must still call searchSemantic() only_
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.3 Add `findByDateRange()` to `SummaryStore`
    - Add `findByDateRange(start: Date, end: Date, repoId?: string): Promise<SummaryInfo[]>`
    - Query `commits` joined to `summaries` where `committedAt >= start AND committedAt < end` and `status = 'done'`
    - Apply `repoId` filter when provided
    - Return `SummaryInfo[]` using existing `rawToSummaryInfo` helper
    - _Requirements: 2.1_

  - [x] 3.4 Include `filesChanged` in LLM context builder
    - Update the context-building `.map()` in `ChatService.ask()` to append `Files: ${s.filesChanged.join(', ')}` to each context block
    - Apply to both direct-lookup results and semantic-search results
    - _Expected_Behavior: LLM prompt contains Files: line for every context block so LLM can cross-check against real file paths_
    - _Requirements: 2.4_

  - [x] 3.5 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Direct Lookup for SHA/Date Questions
    - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
    - The tests from task 1 encode the expected behavior (findBySha called, Files: in context)
    - When these tests pass, it confirms the expected behavior is satisfied
    - Run bug condition exploration tests from step 1
    - **EXPECTED OUTCOME**: Tests PASS (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.4_

  - [x] 3.6 Verify preservation tests still pass
    - **Property 2: Preservation** - General Questions Use Semantic Search Only
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions — general questions still use searchSemantic only)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint — Ensure all tests pass
  - Run the full test suite: `npx vitest --run`
  - Ensure all tests pass; ask the user if questions arise
