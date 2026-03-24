# Implementation Plan: Sync Results & Selective Re-summarization

## Overview

Implement the full sync-results-resummarize feature in TypeScript across backend (Fastify + BullMQ + Prisma) and frontend (React + TanStack Query + Socket.io). Tasks are ordered so each step compiles and integrates cleanly into the previous one — no orphaned code.

## Tasks

- [x] 1. Database schema migration — add `isTrivial` to Summary
  - Add `isTrivial  Boolean  @default(false)` field to the `Summary` model in `prisma/schema.prisma`
  - Create migration: `npx prisma migrate dev --name add_summary_is_trivial`
  - Verify the generated SQL adds the column with a `DEFAULT false` constraint
  - _Requirements: 2.2 (trivial-commit DisplayStatus mapping), 3.1 (Skipped selectability)_

- [x] 2. Update backend types and `CommitJobData`
  - [x] 2.1 Add `isTrivial` and `errorMessage` to `SummaryInfo` in `src/models/types.ts`
    - Add `isTrivial: boolean` and `errorMessage: string | null` fields to the `SummaryInfo` interface (they already exist on the Prisma model; this surfaces them in the domain type)
    - _Requirements: 2.2, 2.7, 6.3_
  - [x] 2.2 Add `force` and `overrideModel` to `CommitJobData` in `src/queues/CommitQueue.ts`
    - Extend `CommitJobSchema` with `force: z.boolean().default(false)` and `overrideModel: z.string().optional()`
    - The inferred `CommitJobData` type will automatically include these fields
    - _Requirements: 5.3, 5.7_

- [x] 3. Update `SummaryStore` — `upsert`, `resetToPending`, and `listByRepo`
  - [x] 3.1 Add `isTrivial` parameter to `SummaryStore.upsert()` in `src/services/SummaryStore.ts`
    - Add optional `isTrivial: boolean = false` as the last parameter
    - Pass it into both the `create` and `update` blocks of the `tx.summary.upsert` call
    - _Requirements: 2.2_
  - [x] 3.2 Add `SummaryStore.resetToPending(shas: string[])` method
    - Implement as `prisma.summary.updateMany({ where: { commitSha: { in: shas } }, data: { status: 'pending', errorMessage: null } })`
    - _Requirements: 5.2_
  - [x] 3.3 Update `SummaryStore.toSummaryInfo()` and `rawToSummaryInfo()` to include `isTrivial`
    - Add `isTrivial: (s.isTrivial ?? false)` to the return object in `toSummaryInfo`
    - Add `isTrivial: (r.isTrivial as boolean) ?? false` in `rawToSummaryInfo`
    - _Requirements: 2.2_
  - [ ]* 3.4 Write unit + property tests for `resetToPending` and `markFailed` round-trip
    - Create `src/services/__tests__/SummaryStore.resummarize.test.ts`
    - Unit test: call `markFailed(sha, repoId, msg)` then `findBySha(sha)` — assert `status === 'failed'` and `errorMessage === msg`
    - Unit test: call `resetToPending([sha])` — assert `status === 'pending'` and `errorMessage === null`
    - **Property 15: Failed summary preserves errorMessage** — generate arbitrary SHA + error message strings via `fc.string()`, call `markFailed`, then `findBySha`, assert round-trip equality
    - **Validates: Requirements 6.3, 5.2**

- [x] 4. Update `commitWorker.ts` — force flag, `isTrivial`, `overrideModel`, Socket.io emit
  - [x] 4.1 Add `io` to `CommitWorkerDeps` interface and `createCommitWorker` signature
    - Add `io?: import('socket.io').Server` to the `CommitWorkerDeps` interface
    - Destructure `io` from `deps` inside `createCommitWorker`
    - _Requirements: 7.1_
  - [x] 4.2 Update idempotency check to respect `force` flag
    - Change the existing early-return guard from `if (existing && existing.status === 'done')` to `if (existing && existing.status === 'done' && !job.data.force)`
    - _Requirements: 5.3_
  - [x] 4.3 Pass `isTrivial: true` in the trivial fast-path `summaryStore.upsert` call
    - In the trivial fast-path block, update the `summaryStore.upsert(...)` call to pass `true` as the new `isTrivial` argument (last parameter)
    - _Requirements: 2.2_
  - [x] 4.4 Use `overrideModel` when present for pipeline execution
    - Resolve the effective model: `const effectiveModel = job.data.overrideModel ?? llmModel`
    - Pass `effectiveModel` to `summaryStore.upsert` in place of `llmModel` for both the trivial path and the full pipeline path
    - _Requirements: 5.7, 4.4_
  - [x] 4.5 Emit `summary:updated` Socket.io events on job `completed` and `failed`
    - In the `worker.on('completed', ...)` handler, add: `io?.to(\`repo:${job.data.repoId}\`).emit('summary:updated', { repoId: job.data.repoId, commitSha: job.data.sha, status: 'done', isTrivial: result.trivial ?? false })`
    - In the `worker.on('failed', ...)` handler, add: `io?.to(\`repo:${job.data.repoId}\`).emit('summary:updated', { repoId: job.data.repoId, commitSha: job.data.sha, status: 'failed', errorMessage: error.message })`
    - _Requirements: 7.1_

- [x] 5. Update `syncWorker.ts` — skip done/failed commits on re-sync
  - Before the `commitQueue.add(...)` call inside the commit loop, add a lookup: `const existingSummary = await prisma.summary.findUnique({ where: { commitSha: commit.sha } })`
  - If `existingSummary?.status === 'done' || existingSummary?.status === 'failed'`, `continue` to skip enqueuing
  - This guard must be placed after the `prisma.commit.upsert` and diff storage calls so the commit record is always persisted regardless
  - _Requirements: 6.2_
  - [ ]* 5.1 Write property tests for syncWorker skip behavior
    - Create `src/workers/__tests__/syncWorker.skipDoneFailed.test.ts`
    - **Property 2: GitHub error leaves checkpoint unchanged** — inject a throwing `githubConnector.getCommits`, assert `lastSyncedSha` and `status` unchanged after `runSync` rejects
    - **Property 3: Successful sync sets correct checkpoint** — generate arbitrary commit lists, assert `lastSyncedSha === commits[last].sha` and `status === 'idle'`
    - **Property 16: SyncWorker skips done/failed on re-sync** — seed summaries with `done`/`failed` status, run `runSync` with a mock queue, assert no jobs enqueued for those SHAs
    - **Validates: Requirements 1.2, 1.3, 6.2**

- [x] 6. Add `POST /repos/:repoId/summaries/resummarize` endpoint to `src/api/routes/summaries.ts`
  - Add `commitQueue: Queue<CommitJobData>` to `SummaryRouteDeps` interface
  - Implement the handler:
    1. Parse body — return 400 if `shas` is empty or missing
    2. For each SHA, call `prisma.commit.findUnique({ where: { sha } })` — return 404 `{ error: 'Commit not found', sha }` for the first missing one
    3. Call `summaryStore.resetToPending(shas)`
    4. For each SHA, call `commitQueue.add(\`resummarize-${sha}\`, { sha, repoId, owner, repo, branch, force: true, overrideModel: model }, { jobId: \`force-${sha}\` })`
       - Fetch `owner`, `repo`, `branch` from `prisma.repository.findUnique({ where: { id: repoId } })`
    5. Return `reply.code(202).send({ enqueued: shas.length })`
  - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6_

- [x] 7. Add `GET /config/models` route and wire `io` into `createCommitWorker` in `src/index.ts`
  - [x] 7.1 Create `src/api/routes/config.ts` with the `GET /config/models` handler
    - Define `PROVIDER_MODELS` map: `{ openai: [...], anthropic: [...], gemini: [...], ollama: [...], deepseek: [...] }`
    - Handler returns `{ provider: config.llmProvider, models: [...(PROVIDER_MODELS[provider] ?? []), config.llmModel].filter unique, default: config.llmModel }`
    - Export `configRoutes(fastify, { config })` function
    - _Requirements: 4.1_
  - [x] 7.2 Register `configRoutes` in `src/api/server.ts`
    - Import and call `await configRoutes(fastify, { config })` alongside the other route registrations
    - Add `config` to `ServerDeps` interface
    - Pass `config` through from `src/index.ts` → `createServer`
    - _Requirements: 4.1_
  - [x] 7.3 Pass `io` into `createCommitWorker` in `src/index.ts`
    - Destructure `io` from the `createServer(...)` return value
    - Pass `io` as a dep to `createCommitWorker({ ..., io })`
    - Also pass `commitQueue` to `summaryRoutes` by updating `createServer` to forward it
    - _Requirements: 7.1_

- [x] 8. Update `src/api/server.ts` to forward `commitQueue` to `summaryRoutes`
  - Pass `commitQueue` into the `summaryRoutes(fastify, { summaryStore, prisma, commitQueue })` call
  - This wires the queue into the resummarize endpoint added in task 6
  - _Requirements: 5.2_

- [x] 9. Checkpoint — backend complete
  - Ensure all backend TypeScript compiles without errors: `npx tsc --noEmit`
  - Ensure all backend tests pass: `npx vitest run src/`
  - Ask the user if any questions arise before proceeding to frontend

- [x] 10. Update frontend types and API client in `client/src/lib/api.ts`
  - Add `isTrivial: boolean` and `errorMessage: string | null` to the `SummaryInfo` interface
  - Add `resummarize` to `api.summaries`: `resummarize: (repoId: string, body: { shas: string[]; model: string }) => apiFetch<{ enqueued: number }>(\`/repos/${repoId}/summaries/resummarize\`, { method: 'POST', body: JSON.stringify(body) })`
  - Add `api.config` namespace: `config: { models: () => apiFetch<{ provider: string; models: string[]; default: string }>('/config/models') }`
  - _Requirements: 4.1, 5.1_

- [x] 11. Create `client/src/lib/displayStatus.ts` — pure mapping utilities
  - Export `DisplayStatus` type: `'Summarized' | 'Skipped' | 'Processing' | 'Queued' | 'Failed'`
  - Export `toDisplayStatus(status: string, isTrivial: boolean): DisplayStatus` — mapping per design §7
  - Export `shouldAutoDismiss(summaries: SummaryInfo[]): boolean` — true iff non-empty and all are Summarized or Skipped
  - Export `isSelectable(status: DisplayStatus): boolean` — true iff Failed or Skipped
  - Export `getPreselectedModel(summaries: SummaryInfo[], defaultModel: string): string` — returns `llmModel` of the most recent `done` summary by `committedAt`, or `defaultModel`
  - _Requirements: 2.2, 2.4, 2.5, 3.1, 3.6, 4.2_
  - [ ]* 11.1 Write unit + property tests for `displayStatus.ts`
    - Create `client/src/__tests__/displayStatus.test.ts`
    - Unit tests: all 8 `(status, isTrivial)` combinations for `toDisplayStatus`; all 5 DisplayStatus values for `isSelectable`; `shouldAutoDismiss` with empty list, all-summarized, mixed, all-failed
    - **Property 5: toDisplayStatus is total and correct** — `fc.constantFrom('pending','processing','done','failed')` × `fc.boolean()`, assert output is always one of the 5 values and matches the mapping table
    - **Property 6: Grouping covers all commits without duplication** — `fc.array(fc.record({...}))`, group by DisplayStatus, assert every summary in exactly one group and counts sum to total
    - **Property 7: shouldAutoDismiss predicate is correct** — generate arbitrary summary arrays, assert returns true iff all are Summarized/Skipped and list is non-empty
    - **Property 9: isSelectable exclusive to Failed and Skipped** — `fc.constantFrom(...all 5 values)`, assert true iff Failed or Skipped
    - **Property 10: Select All Failed selects exactly failed commits** — generate arbitrary summary arrays, assert selected set equals exactly the Failed SHAs
    - **Property 11: Pre-selected model is most recent successful model** — generate arrays with varying `llmModel` and `committedAt`, assert `getPreselectedModel` returns the `llmModel` of the most recent done summary or the default
    - **Property 17: Socket event state reducer is correct** — generate arbitrary state maps and `summary:updated` events, assert reducer updates only the targeted SHA
    - **Validates: Requirements 2.2, 2.4, 2.5, 3.1, 3.2, 3.6, 4.2, 7.2**

- [x] 12. Create `client/src/components/repos/SyncResultsView.tsx`
  - Props: `{ repoId: string; summaries: SummaryInfo[]; onClose: () => void }`
  - Internal state: `localSummaries: SummaryInfo[]` initialized from `summaries` prop; updated by Socket.io events
  - On mount, call `subscribeToRepo(repoId)` and attach a `summary:updated` listener on `getSocket()` that applies the state reducer: find the matching SHA in `localSummaries` and update its `status`, `isTrivial`, and `errorMessage`
  - Group `localSummaries` by `toDisplayStatus` — render one section per group (only render groups with count > 0)
  - Each group header: group label + count badge
  - Each commit row: `commitSha.slice(0,8)` in a `<code>` tag, `authorName`, DisplayStatus badge with color coding (`#3fb950` Summarized, `#8b949e` Skipped/Processing/Queued, `#f85149` Failed), and `errorMessage` text for Failed rows
  - Show a "remaining jobs" progress indicator when any commit has status `Processing` or `Queued`
  - Render `<ResummarizePanel>` below the list when any commit has `isSelectable` DisplayStatus
  - _Requirements: 2.1, 2.3, 2.6, 2.7, 7.2, 7.3_

- [x] 13. Create `client/src/components/repos/ResummarizePanel.tsx`
  - Props: `{ repoId: string; selectableSummaries: SummaryInfo[]; onComplete: () => void }`
  - State: `selectedShas: Set<string>`, `selectedModel: string`, `isSubmitting: boolean`
  - On mount, call `api.config.models()` to populate the model dropdown; handle loading and error states with inline text
  - Pre-select model via `getPreselectedModel(selectableSummaries, fetchedDefault)`
  - Render a checkbox list of selectable commits (SHA + author + DisplayStatus badge)
  - "Select All Failed" button: sets `selectedShas` to all SHAs where `toDisplayStatus(s.status, s.isTrivial) === 'Failed'`
  - Show selected count: `{selectedShas.size} commit(s) selected`
  - Model `<select>` dropdown populated from `api.config.models()` response
  - Submit button: disabled when `selectedShas.size === 0 || isSubmitting`; shows spinner SVG when `isSubmitting`
  - On submit: set `isSubmitting = true`, call `api.summaries.resummarize(repoId, { shas: [...selectedShas], model: selectedModel })`, then call `onComplete()`; on error show inline error message and reset `isSubmitting`
  - Use Tailwind dark theme colors: bg `#161b22`/`#21262d`, borders `#30363d`, text `#e6edf3`/`#8b949e`, accent `#58a6ff`, success `#3fb950`, error `#f85149`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3_

- [x] 14. Update `client/src/components/repos/SyncProgressModal.tsx`
  - Remove the unconditional `isDone → setTimeout(onClose, 2000)` effect
  - Add a `useSummaries` call (or pass summaries as a prop) to fetch the repo's summaries once `isDone` is true — use `useQuery` with `enabled: isDone`
  - Replace the auto-dismiss effect with: `if (isDone && summaries && shouldAutoDismiss(summaries)) { setTimeout(onClose, 2000) }`
  - When `isDone && summaries && !shouldAutoDismiss(summaries)`: hide the progress bar and render `<SyncResultsView repoId={repoId} summaries={summaries} onClose={onClose} />` in its place
  - When `isDone && !summaries` (still loading): show a brief "Loading results…" spinner
  - Import `shouldAutoDismiss` from `../../lib/displayStatus`
  - Import `SyncResultsView` from `./SyncResultsView`
  - _Requirements: 2.4, 2.5_

- [x] 15. Final checkpoint — full stack integration
  - Ensure all TypeScript compiles: `npx tsc --noEmit` (root) and `npx tsc --noEmit` (client)
  - Ensure all tests pass: `npx vitest run`
  - Verify the migration was applied: `npx prisma migrate status`
  - Ask the user if any questions arise before marking complete

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Checkpoints (tasks 9 and 15) ensure incremental validation before moving to the next layer
- Property tests validate universal correctness properties; unit tests validate specific examples and edge cases
- The `io` instance flows: `createServer` returns it → `src/index.ts` passes it to `createCommitWorker` — no global state needed
- The `commitQueue` flows into `summaryRoutes` via `ServerDeps` → `createServer` → route registration
