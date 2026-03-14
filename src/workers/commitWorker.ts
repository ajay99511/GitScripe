import { Worker, Job } from 'bullmq';
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

const logger = pino({ name: 'CommitWorker' });

interface CommitWorkerDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connection: any;
  concurrency: number;
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
    pipeline,
    githubConnector,
    diffStorage,
    redisCache,
    summaryStore,
    prisma,
    llmModel,
  } = deps;

  const worker = new Worker<CommitJobData>(
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

        // Step 4: Run the pipeline
        const result = await pipeline.run(commitInfo, diff);

        const processingMs = Date.now() - startMs;

        if (result.error || !result.summaryDraft) {
          await summaryStore.markFailed(sha, repoId, result.error ?? 'Unknown pipeline error');
          logger.error({ sha, error: result.error, processingMs }, 'Pipeline failed');
          throw new Error(result.error ?? 'Pipeline produced no summary');
        }

        // Step 5: Upsert the summary
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
        const processingMs = Date.now() - startMs;
        const msg = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ sha, error, processingMs }, 'Commit processing failed');

        await summaryStore.markFailed(sha, repoId, msg);
        throw error; // Let BullMQ retry
      }
    },
    {
      connection,
      concurrency,
      limiter: {
        max: concurrency,
        duration: 1000,
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
