# Requirements Document

## Introduction

GitScripe syncs GitHub repositories and uses LLM agents to summarize commits. Currently, when a sync completes, the `lastSyncedSha` checkpoint advances regardless of whether pipeline jobs succeeded or failed — meaning failed commits are silently dropped and never re-fetched. The `SyncProgressModal` auto-dismisses even when commits failed, and there is no way for users to force re-processing of specific commits.

This feature introduces a **Sync Results** view that surfaces per-commit outcomes after a sync, and a **Selective Re-summarization** capability that lets users pick failed or skipped commits and re-run the LLM pipeline on them — with control over which model to use.

---

## Glossary

- **SyncWorker**: The backend module (`syncWorker.ts`) that fetches commits from GitHub, stores metadata and diffs, enqueues pipeline jobs, and advances the `lastSyncedSha` checkpoint.
- **CommitWorker**: The BullMQ worker (`commitWorker.ts`) that processes individual commit jobs through the `CommitPipeline`.
- **CommitPipeline**: The LangGraph-based agent pipeline (DiffAnalyzer → SummaryAgent → CriticAgent) that produces a `SummaryDraft` for a commit.
- **SummaryStore**: The service (`SummaryStore.ts`) that persists summaries to PostgreSQL and manages their lifecycle.
- **SyncProgressModal**: The frontend modal component that shows live sync progress during an active sync.
- **SyncResultsView**: The new frontend component introduced by this feature that displays per-commit outcomes after a sync completes.
- **ResummarizePanel**: The new frontend component that allows users to select commits and trigger re-summarization.
- **LLMProvider**: The configurable LLM backend (OpenAI, Anthropic, or Ollama) used by the CommitPipeline.
- **SummaryStatus**: The enum of commit processing states: `pending`, `processing`, `done`, `failed`.
- **DisplayStatus**: The user-facing label mapped from `SummaryStatus` plus the trivial-commit fast-path: `Summarized`, `Processing`, `Queued`, `Failed`, `Skipped`.
- **Trivial Commit**: A commit classified by `isTrivialCommit()` as a minor change (docs, formatting, dependency bumps) that bypasses the LLM pipeline and receives a fast-path summary.
- **Force Re-summarize**: A re-summarization request that bypasses the `status === 'done'` idempotency guard in the CommitWorker.
- **Sync Checkpoint**: The `lastSyncedSha` value stored on a `Repository` record, marking the most recent commit fetched from GitHub.

---

## Requirements

### Requirement 1: Sync Checkpoint Integrity

**User Story:** As a developer, I want failed commits to remain eligible for re-fetching on the next sync, so that pipeline failures do not permanently drop commits from the history.

#### Acceptance Criteria

1. WHEN the SyncWorker enqueues all commit jobs for a repository, THE SyncWorker SHALL advance the Sync Checkpoint only after all commit records and diff objects have been persisted to the database and object storage.
2. WHEN the SyncWorker encounters a GitHub API error while fetching commits, THE SyncWorker SHALL NOT advance the Sync Checkpoint and SHALL set the repository status to `error`.
3. WHEN the SyncWorker completes without error, THE SyncWorker SHALL set the repository status to `idle` and record the SHA of the most recently fetched commit as the Sync Checkpoint.
4. WHEN the CommitWorker fails to process a commit job, THE SyncWorker SHALL NOT roll back the Sync Checkpoint — the commit record and pending Summary record remain in the database for user-initiated re-summarization.

---

### Requirement 2: Sync Results View

**User Story:** As a developer, I want to see a grouped breakdown of commit outcomes after a sync finishes, so that I can immediately understand what succeeded, what failed, and what was skipped.

#### Acceptance Criteria

1. WHEN a sync transitions from `syncing` to `idle` and at least one commit was processed, THE SyncResultsView SHALL display commits grouped by DisplayStatus: `Summarized`, `Processing`, `Queued`, `Failed`, and `Skipped`.
2. THE SyncResultsView SHALL map `SummaryStatus` values to DisplayStatus labels as follows: `done` → `Summarized`, `processing` → `Processing`, `pending` → `Queued`, `failed` → `Failed`, and trivial-commit fast-path summaries → `Skipped`.
3. THE SyncResultsView SHALL display the count of commits in each DisplayStatus group.
4. WHEN all commits have DisplayStatus `Summarized` or `Skipped`, THE SyncProgressModal SHALL auto-dismiss after 2 seconds.
5. WHEN one or more commits have DisplayStatus `Failed` or `Queued`, THE SyncProgressModal SHALL NOT auto-dismiss and SHALL remain open until the user explicitly closes it or takes action.
6. THE SyncResultsView SHALL display each commit entry with: the short SHA (first 8 characters), the commit author name, and the DisplayStatus label.
7. WHEN a commit has DisplayStatus `Failed`, THE SyncResultsView SHALL display the stored `errorMessage` for that commit.

---

### Requirement 3: Selective Re-summarization

**User Story:** As a developer, I want to select one or more failed or skipped commits and re-run the LLM pipeline on them, so that I can recover from transient failures without triggering a full re-sync.

#### Acceptance Criteria

1. THE ResummarizePanel SHALL allow the user to select individual commits with DisplayStatus `Failed` or `Skipped` for re-summarization.
2. THE ResummarizePanel SHALL provide a "Select All Failed" control that selects all commits with DisplayStatus `Failed` in a single action.
3. WHEN the user has selected one or more commits, THE ResummarizePanel SHALL display a confirmation showing the count of selected commits before submission.
4. WHEN the user submits a re-summarization request, THE ResummarizePanel SHALL send the selected commit SHAs and the chosen LLM model identifier to the backend re-summarize endpoint.
5. WHEN a re-summarization request is submitted, THE ResummarizePanel SHALL disable the submit control and display a loading indicator until the backend acknowledges the request.
6. THE ResummarizePanel SHALL NOT allow re-summarization of commits with DisplayStatus `Summarized` or `Processing`.

---

### Requirement 4: LLM Model Selection for Re-summarization

**User Story:** As a developer, I want to choose which LLM model is used when re-summarizing commits, so that I can switch to a more capable or cost-effective model for retries.

#### Acceptance Criteria

1. THE ResummarizePanel SHALL present a model selector populated with the LLM models available in the current LLMProvider configuration.
2. THE ResummarizePanel SHALL pre-select the model that was used for the most recent successful summary in the repository, falling back to the system default model when no prior summary exists.
3. WHEN the user selects a model and submits a re-summarization request, THE ResummarizePanel SHALL pass the selected model identifier to the backend.
4. WHEN a re-summarization completes, THE SummaryStore SHALL record the model identifier used in the `llmModel` field of the updated Summary record.

---

### Requirement 5: Force Re-summarize API Endpoint

**User Story:** As a developer, I want a backend endpoint that forces re-processing of a specific commit, so that the frontend can trigger re-summarization without being blocked by the existing idempotency guard.

#### Acceptance Criteria

1. THE System SHALL expose a `POST /repos/:repoId/summaries/resummarize` endpoint that accepts a JSON body containing an array of commit SHAs and a model identifier.
2. WHEN the endpoint receives a valid request, THE System SHALL reset the `status` of each specified Summary record to `pending` and enqueue a new CommitWorker job for each SHA.
3. WHEN the CommitWorker processes a Force Re-summarize job, THE CommitWorker SHALL bypass the `status === 'done'` idempotency check and run the full CommitPipeline regardless of the current Summary status.
4. WHEN the endpoint receives a SHA that does not correspond to a Commit record in the database, THE System SHALL return a `404` response for that SHA and SHALL NOT enqueue a job for it.
5. WHEN the endpoint receives a request with an empty SHA array, THE System SHALL return a `400` response.
6. WHEN the endpoint successfully enqueues all requested jobs, THE System SHALL return a `202` response containing the count of jobs enqueued.
7. WHEN a Force Re-summarize job is enqueued, THE System SHALL use the model identifier from the request body rather than the default `llmModel` configured in the CommitWorker environment.

---

### Requirement 6: No Automatic Retry Loop

**User Story:** As a developer, I want failed commits to stay in the `failed` state until I explicitly act, so that the system does not enter an uncontrolled retry loop that consumes LLM quota.

#### Acceptance Criteria

1. WHEN a CommitWorker job fails after exhausting BullMQ retries, THE SummaryStore SHALL set the Summary status to `failed` and SHALL NOT automatically re-enqueue the job.
2. WHEN the SyncWorker runs a subsequent sync for a repository, THE SyncWorker SHALL NOT re-enqueue CommitWorker jobs for commits whose Summary status is `failed` or `done`.
3. WHEN a commit has Summary status `failed`, THE System SHALL preserve the `errorMessage` field so the user can inspect the failure reason.

---

### Requirement 7: Real-time Status Updates During Re-summarization

**User Story:** As a developer, I want the Sync Results View to update in real time as re-summarization jobs complete, so that I can see progress without manually refreshing.

#### Acceptance Criteria

1. WHEN a CommitWorker job completes or fails for a Force Re-summarize request, THE System SHALL emit a Socket.io event to the repository's room with the updated Summary status and commit SHA.
2. WHEN the SyncResultsView receives a Socket.io status update for a commit, THE SyncResultsView SHALL update that commit's DisplayStatus label without requiring a full page reload.
3. WHILE one or more re-summarization jobs are in progress for a repository, THE SyncResultsView SHALL display a progress indicator showing the count of remaining jobs.
