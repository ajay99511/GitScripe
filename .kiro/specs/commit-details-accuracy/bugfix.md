# Bugfix Requirements Document

## Introduction

When a user asks the chat interface about a specific commit (e.g., "what was in the Oct 26, 2020 commit dc387a9?"), the system returns fabricated content that has no relation to the actual commit. In the reported case, the LLM described an "EnGram Progress Guide" with invented sections — none of which exist in the real commit, which contained C++ scheduling algorithm files under `src/experiment/`.

The root cause is in `ChatService.ask()`: it retrieves context exclusively via semantic vector search over pre-generated summaries. If the stored summary for a commit was itself hallucinated (generated from a bad or missing diff), the LLM receives and faithfully repeats that hallucinated content. The user's question never triggers a lookup of the actual commit data — the system has no mechanism to ground its answer in real commit content when a specific SHA or date is mentioned.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user asks about a specific commit by SHA or date THEN the system performs only a semantic vector search over stored summaries and passes those summaries as the sole context to the LLM

1.2 WHEN the stored summary for a commit contains hallucinated or inaccurate content THEN the system returns that hallucinated content to the user as if it were factual

1.3 WHEN a specific commit SHA is mentioned in the user's question THEN the system does not attempt a direct lookup of that commit's stored summary by SHA, relying solely on embedding similarity

1.4 WHEN the semantic search retrieves summaries that are semantically similar to the query but belong to different commits THEN the system presents those unrelated summaries as the answer to the user's specific commit question

### Expected Behavior (Correct)

2.1 WHEN a user asks about a specific commit by SHA or date THEN the system SHALL detect the specific commit reference and attempt a direct lookup of that commit's stored summary by SHA before falling back to semantic search

2.2 WHEN a direct SHA lookup returns a stored summary THEN the system SHALL use that summary as the primary context, ensuring the answer is grounded in the data actually associated with that commit

2.3 WHEN the stored summary for a commit contains content that does not match the commit's actual file changes THEN the system SHALL NOT surface that summary as a confident answer without indicating uncertainty

2.4 WHEN a user asks about a specific commit and the system retrieves context THEN the system SHALL include the commit's `filesChanged` list in the LLM context so the LLM can cross-check its answer against known file paths

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user asks a general question about the repository (e.g., "what changed last month?") THEN the system SHALL CONTINUE TO use semantic vector search to retrieve relevant summaries

3.2 WHEN a user asks about a topic or concept across commits (e.g., "when was authentication added?") THEN the system SHALL CONTINUE TO return semantically relevant results ranked by similarity

3.3 WHEN no relevant commits are found for a question THEN the system SHALL CONTINUE TO return the "no relevant commits" fallback message

3.4 WHEN the chat endpoint receives a question with a repoId THEN the system SHALL CONTINUE TO scope the search to that repository only
