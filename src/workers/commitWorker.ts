import { Worker, Job } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import type { Server as SocketIOServer } from 'socket.io';
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
  const retryMatch = error.message.match(/retry after (\d+)/i) ??
                     error.message.match(/(\d+)\s*second/i);
  const retrySeconds = retryMatch ? parseInt(retryMatch[1]!, 10) : 60;
  return retrySeconds * 1000;
}

export interface CommitWorkerDeps {
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
  io?: SocketIOServer;
}

export function createCommitWorker(deps: CommitWorkerDeps): Worker<CommitJobData> {
  const {
    connection, concurrency, llmMaxJobsPerWindow, llmRateLimitWindowMs,
    pipeline, githubConnector, diffStorage, redisCache, summaryStore, prisma, llmModel, io,
  } = deps;

  let worker: Worker<CommitJobData>;

  worker = new Worker<CommitJobData>(
    QUEUE_NAME,
    async (job: Job<CommitJobData>) => {
      const { sha, repoId, owner, repo, force = false, overrideModel } = job.data;
      const effectiveModel = overrideModel ?? llmModel;
      const startMs = Date.now();

      logger.info({ sha, owner, repo, jobId: job.id, force }, 'Processing commit');

      // Step 1: Idempotency check — bypassed when force=true
      const existing = await summaryStore.findBySha(sha);
      if (existing && existing.status === 'done' && !force) {
        logger.info({ sha }, 'Commit already processed, skipping');
        return { skipped: true };
      }

      try {
        // Step 2: Get the diff (cache → MinIO → GitHub)
        let diff = await redisCache.getCachedDiff(repoId, sha);

        if (!diff) {
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
          diff = await githubConnector.getDiff(owner, repo, sha);
          const objectKey = await diffStorage.saveDiff(sha, diff);
          await prisma.commit.update({ where: { sha }, data: { diffObjectKey: objectKey } });
          await redisCache.cacheDiff(repoId, sha, diff);
        }

        // Step 3: Get commit info
        const commitRecord = await prisma.commit.findUnique({ where: { sha } });
        if (!commitRecord) throw new Error(`Commit ${sha} not found in database`);

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

        // Step 4: Fast-path trivial commits
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
          await summaryStore.upsert(sha, repoId, trivialDraft, effectiveModel, Date.now() - startMs, 1.0, [], true);
          return { sha, processingMs: Date.now() - startMs, qualityScore: 1.0, skipped: false, trivial: true };
        }

        // Step 5: Run the full pipeline
        let result;
        try {
          result = await pipeline.run(commitInfo, diff);
        } catch (pipelineError) {
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
          sha, repoId, result.summaryDraft, effectiveModel,
          processingMs, result.qualityScore ?? 1.0, result.extractedConcepts ?? [], false
        );

        logger.info({ sha, processingMs, qualityScore: result.qualityScore }, 'Commit processed');
        return { sha, processingMs, qualityScore: result.qualityScore, skipped: false, trivial: false };

      } catch (error) {
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
      limiter: { max: llmMaxJobsPerWindow, duration: llmRateLimitWindowMs },
    }
  );

  worker.on('completed', (job, result) => {
    logger.debug({ jobId: job.id, sha: job.data.sha }, 'Job completed');
    io?.to(`repo:${job.data.repoId}`).emit('summary:updated', {
      repoId: job.data.repoId,
      commitSha: job.data.sha,
      status: 'done',
      isTrivial: (result as { trivial?: boolean })?.trivial ?? false,
    });
  });

  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, sha: job?.data.sha, error: error.message }, 'Job failed');
    if (!job) return;
    io?.to(`repo:${job.data.repoId}`).emit('summary:updated', {
      repoId: job.data.repoId,
      commitSha: job.data.sha,
      status: 'failed',
      errorMessage: error.message,
    });
  });

  return worker;
}
