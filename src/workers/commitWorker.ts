import { Worker, Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import pino from 'pino';
import type { CommitJobData } from '../queues/CommitQueue.js';
import { QUEUE_NAME } from '../queues/CommitQueue.js';
import type { CommitPipeline } from '../orchestration/CommitPipeline.js';
import type { GitHubConnector } from '../connectors/GitHubConnector.js';
import type { DiffStorage } from '../connectors/DiffStorage.js';
import type { RedisCache } from '../connectors/RedisCache.js';
import type { SummaryStore } from '../services/SummaryStore.js';
import type { PrismaClient } from '@prisma/client';
import type { CommitInfo } from '../models/types.js';
import { isTrivialCommit } from '../utils/diffPreprocessor.js';

const logger = pino({ name: 'CommitWorker' });

/**
 * Detect LLM provider rate limit errors (429) from various providers.
 * Returns the suggested retry-after delay in ms, or null if not a rate limit error.
 */
function detectRateLimitError(error: unknown): number | null {
  if (!(error instanceof Error)) return null;

  const msg = error.message.toLowerCase();
  const isRateLimit =
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('too many requests') ||
    msg.includes('quota exceeded') ||
    msg.includes('resource_exhausted');

  if (!isRateLimit) return null;

  // Try to extract retry-after from the error message (OpenAI includes it)
  const retryMatch = error.message.match(/retry after (\d+)/i) ??
                     error.message.match(/(\d+)\s*second/i);
  const retrySeconds = retryMatch ? parseInt(retryMatch[1]!, 10) : 60;

  return retrySeconds * 1000;
}

interface CommitWorkerDeps {
  connection: ConnectionOptions;
  concurrency: number;
  llmMaxJobsPerWindow: number;
  llmRateLimitWindowMs: number;
  pipeline: CommitPipeline;
  githubConnector: GitHubConnector;
  diffStorage: DiffStorage;
  redisCache: RedisCache;
  summaryStore: SummaryStore;
  prisma: PrismaClient;
  llmModel: string;
}

/**
 * BullMQ Worker that processes individual commits through the agent pipeline.
 *
 * Per job:
 * 1. Check if already processed (idempotency)
 * 2. Fetch diff from cache → MinIO → GitHub (fallback chain)
 * 3. Run CommitPipeline (DiffAnalyzer → SummaryAgent)
 * 4. Upsert summary with embedding
 */
export function createCommitWorker(deps: CommitWorkerDeps): Worker<CommitJobData> {
  const {
    connection,
    concurrency,
    llmMaxJobsPerWindow,
    llmRateLimitWindowMs,
    pipeline,
    githubConnector,
    diffStorage,
    redisCache,
    summaryStore,
    prisma,
    llmModel,
  } = deps;

  let worker: Worker<CommitJobData>;

  worker = new Worker<CommitJobData>(
    QUEUE_NAME,
    async (job: Job<CommitJobData>) => {
      const { sha, repoId, owner, repo } = job.data;
      const startMs = Date.now();

      logger.info({ sha, owner, repo, jobId: job.id }, 'Processing commit');

      // Step 1: Check if already processed (SHA-keyed idempotency)
      const existing = await summaryStore.findBySha(sha);
      if (existing && existing.status === 'done') {
        logger.info({ sha }, 'Commit already processed, skipping');
        return { skipped: true };
      }

      try {
        // Step 2: Get the diff (cache → MinIO → GitHub)
        let diff = await redisCache.getCachedDiff(repoId, sha);

        if (!diff) {
          // Try MinIO
          const commit = await prisma.commit.findUnique({ where: { sha } });
          if (commit?.diffObjectKey) {
            try {
              diff = await diffStorage.getDiff(commit.diffObjectKey);
            } catch {
              logger.debug({ sha }, 'Diff not in MinIO, fetching from GitHub');
            }
          }
        }

        if (!diff) {
          // Fetch from GitHub and store
          diff = await githubConnector.getDiff(owner, repo, sha);

          // Store in MinIO for future use
          const objectKey = await diffStorage.saveDiff(sha, diff);
          await prisma.commit.update({
            where: { sha },
            data: { diffObjectKey: objectKey },
          });

          // Cache in Redis
          await redisCache.cacheDiff(repoId, sha, diff);
        }

        // Step 3: Get commit info
        const commitRecord = await prisma.commit.findUnique({ where: { sha } });
        if (!commitRecord) {
          throw new Error(`Commit ${sha} not found in database`);
        }

        const commitInfo: CommitInfo = {
          sha: commitRecord.sha,
          repoId: commitRecord.repoId,
          authorName: commitRecord.authorName,
          authorEmail: commitRecord.authorEmail,
          message: commitRecord.message,
          committedAt: commitRecord.committedAt,
          filesChanged: commitRecord.filesChanged as string[],
          additions: commitRecord.additions,
          deletions: commitRecord.deletions,
          diffObjectKey: commitRecord.diffObjectKey ?? undefined,
        };

        // Step 4: Fast-path trivial commits — skip LLM entirely
        if (isTrivialCommit(diff, commitInfo.additions, commitInfo.deletions)) {
          logger.info({ sha }, 'Trivial commit detected — using fast-path summary');
          const trivialDraft = {
            shortSummary: commitInfo.message.split('\n')[0] ?? 'Minor update',
            detailedSummary: `Trivial change by ${commitInfo.authorName}: ${commitInfo.message}`,
            inferredIntent: 'Documentation, formatting, or dependency update with no functional change.',
            fileSummaries: {} as Record<string, string>,
            moduleSummaries: {} as Record<string, string>,
            tags: ['docs', 'chore'],
            riskLevel: 'low' as const,
          };
          await summaryStore.upsert(sha, repoId, trivialDraft, llmModel, Date.now() - startMs, 1.0, []);
          return { sha, processingMs: Date.now() - startMs, qualityScore: 1.0, skipped: false, trivial: true };
        }

        // Step 5: Run the full pipeline
        let result;
        try {
          result = await pipeline.run(commitInfo, diff);
        } catch (pipelineError) {
          // Detect LLM 429 — move job back to waiting instead of failing it
          const rateLimitMs = detectRateLimitError(pipelineError);
          if (rateLimitMs !== null) {
            logger.warn({ sha, retryAfterMs: rateLimitMs }, 'LLM rate limit hit — requeueing job');
            await worker.rateLimit(rateLimitMs);
            throw Worker.RateLimitError();
          }
          throw pipelineError;
        }

        const processingMs = Date.now() - startMs;

        if (result.error || !result.summaryDraft) {
          await summaryStore.markFailed(sha, repoId, result.error ?? 'Unknown pipeline error');
          logger.error({ sha, error: result.error, processingMs }, 'Pipeline failed');
          throw new Error(result.error ?? 'Pipeline produced no summary');
        }

        // Step 6: Upsert the summary
        await summaryStore.upsert(
          sha,
          repoId,
          result.summaryDraft,
          llmModel,
          processingMs,
          result.qualityScore ?? 1.0,
          result.extractedConcepts ?? []
        );

        logger.info({ sha, processingMs, qualityScore: result.qualityScore, concepts: result.extractedConcepts?.length }, 'Commit processed');

        return {
          sha,
          processingMs,
          qualityScore: result.qualityScore,
          skipped: false,
        };
      } catch (error) {
        // Don't double-handle RateLimitError — BullMQ manages it
        if (error instanceof Error && error.message === Worker.RateLimitError().message) throw error;

        const processingMs = Date.now() - startMs;
        const msg = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ sha, error, processingMs }, 'Commit processing failed');

        await summaryStore.markFailed(sha, repoId, msg);
        throw error;
      }
    },
    {
      connection,
      concurrency,
      limiter: {
        // Global rate limit across all workers — tune via LLM_MAX_JOBS_PER_WINDOW
        // and LLM_RATE_LIMIT_WINDOW_MS env vars to match your provider tier.
        // Default: 10 jobs per 60s (safe for OpenAI Tier 1 / Anthropic Tier 1)
        max: llmMaxJobsPerWindow,
        duration: llmRateLimitWindowMs,
      },
    }
  );

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, sha: job.data.sha }, 'Job completed');
  });

  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, sha: job?.data.sha, error: error.message }, 'Job failed');
  });

  return worker;
}
