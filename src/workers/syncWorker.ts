import type { Queue } from 'bullmq';
import type { PrismaClient, Prisma } from '@prisma/client';
import pino from 'pino';
import type { CommitJobData } from '../queues/CommitQueue.js';
import type { GitHubConnector } from '../connectors/GitHubConnector.js';
import type { DiffStorage } from '../connectors/DiffStorage.js';
import type { RepoManager } from '../services/RepoManager.js';

const logger = pino({ name: 'SyncWorker' });

interface SyncWorkerDeps {
  prisma: PrismaClient;
  githubConnector: GitHubConnector;
  diffStorage: DiffStorage;
  repoManager: RepoManager;
  commitQueue: Queue<CommitJobData>;
}

/**
 * Orchestrates the full sync for a repository:
 * 1. Fetch all commits since lastSyncedSha
 * 2. Store commit metadata + diffs in MinIO
 * 3. Enqueue each commit for pipeline processing
 * 4. Update the sync checkpoint
 */
export async function runSync(repoId: string, deps: SyncWorkerDeps): Promise<number> {
  const { prisma, githubConnector, diffStorage, repoManager, commitQueue } = deps;

  const repo = await repoManager.startSync(repoId);

  logger.info(
    { repoId, owner: repo.owner, name: repo.name, since: repo.lastSyncedSha },
    'Starting repository sync'
  );

  try {
    // Step 1: Fetch commits from GitHub
    const commits = await githubConnector.getCommits(
      repo.owner,
      repo.name,
      repo.branch,
      repo.lastSyncedSha ?? undefined
    );

    logger.info({ repoId, commitCount: commits.length }, 'Fetched commits from GitHub');

    if (commits.length === 0) {
      await repoManager.completeSyncCheckpoint(repoId, repo.lastSyncedSha ?? '');
      logger.info({ repoId }, 'No new commits — sync complete');
      return 0;
    }

    // Step 2: Store commit records and diffs
    for (const commit of commits) {
      commit.repoId = repoId;

      // Fetch file list for this commit — small delay to avoid GitHub burst rate limiting
      try {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const files = await githubConnector.getCommitFiles(repo.owner, repo.name, commit.sha);
        commit.filesChanged = files.map((f) => f.filename);
        commit.additions = files.reduce((sum, f) => sum + f.additions, 0);
        commit.deletions = files.reduce((sum, f) => sum + f.deletions, 0);
      } catch (error) {
        logger.warn({ sha: commit.sha, error }, 'Failed to fetch file list');
      }

      // Upsert commit record
      await prisma.commit.upsert({
        where: { sha: commit.sha },
        create: {
          sha: commit.sha,
          repoId,
          authorName: commit.authorName,
          authorEmail: commit.authorEmail,
          message: commit.message,
          committedAt: commit.committedAt,
          filesChanged: commit.filesChanged as unknown as Prisma.InputJsonValue,
          additions: commit.additions,
          deletions: commit.deletions,
        },
        update: {
          filesChanged: commit.filesChanged as unknown as Prisma.InputJsonValue,
          additions: commit.additions,
          deletions: commit.deletions,
        },
      });

      // Fetch and store diff in MinIO (if not already stored)
      try {
        const diffExists = await diffStorage.exists(commit.sha);
        if (!diffExists) {
          const diffText = await githubConnector.getDiff(repo.owner, repo.name, commit.sha);
          const objectKey = await diffStorage.saveDiff(commit.sha, diffText);
          await prisma.commit.update({
            where: { sha: commit.sha },
            data: { diffObjectKey: objectKey },
          });
        }
      } catch (error) {
        logger.warn({ sha: commit.sha, error }, 'Failed to store diff (will retry in worker)');
      }

      // Step 3: Enqueue for pipeline processing — skip if already done or failed
      const existingSummary = await prisma.summary.findUnique({ where: { commitSha: commit.sha } });
      if (existingSummary && (existingSummary.status === 'done' || existingSummary.status === 'failed')) {
        logger.debug({ sha: commit.sha, status: existingSummary.status }, 'Skipping already-processed commit');
        continue;
      }

      await commitQueue.add(
        `process-${commit.sha}`,
        {
          sha: commit.sha,
          repoId,
          owner: repo.owner,
          repo: repo.name,
          branch: repo.branch,
        },
        {
          jobId: commit.sha, // Ensures deduplication
        }
      );

      // Create pending summary record
      await prisma.summary.upsert({
        where: { commitSha: commit.sha },
        create: {
          commitSha: commit.sha,
          repoId,
          shortSummary: '',
          detailedSummary: '',
          inferredIntent: '',
          status: 'pending',
        },
        update: {}, // Don't overwrite if already exists
      });
    }

    // Step 4: Update sync checkpoint to the latest commit SHA
    const latestSha = commits[commits.length - 1]!.sha;
    await repoManager.completeSyncCheckpoint(repoId, latestSha);

    logger.info({ repoId, enqueued: commits.length, latestSha }, 'Sync complete — jobs enqueued');
    return commits.length;
  } catch (error) {
    logger.error({ repoId, error }, 'Sync failed');
    await repoManager.markError(repoId);
    throw error;
  }
}
