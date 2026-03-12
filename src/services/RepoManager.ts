import { PrismaClient, Prisma } from '@prisma/client';
import pino from 'pino';
import type { RepositoryInfo, SyncProgress } from '../models/types.js';

const logger = pino({ name: 'RepoManager' });

/**
 * Manages repository registration, sync triggering, and progress tracking.
 */
export class RepoManager {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Register a GitHub repository. Parses owner/name from the URL.
   * Idempotent — returns existing repo if URL already registered.
   */
  async register(
    githubUrl: string,
    branch: string = 'main'
  ): Promise<RepositoryInfo> {
    // Normalize and parse the GitHub URL
    const normalized = githubUrl
      .replace(/\.git$/, '')
      .replace(/\/$/, '');

    const match = normalized.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) {
      throw new Error(`Invalid GitHub URL: ${githubUrl}`);
    }

    const [, owner, name] = match;

    const repo = await this.prisma.repository.upsert({
      where: { githubUrl: normalized },
      create: {
        githubUrl: normalized,
        owner: owner!,
        name: name!,
        branch,
        status: 'idle',
      },
      update: {
        branch,
      },
    });

    logger.info({ repoId: repo.id, owner, name, branch }, 'Repository registered');

    return {
      id: repo.id,
      githubUrl: repo.githubUrl,
      owner: repo.owner,
      name: repo.name,
      branch: repo.branch,
      lastSyncedSha: repo.lastSyncedSha,
      status: repo.status as 'idle' | 'syncing' | 'error',
    };
  }

  /**
   * Set repo status to 'syncing'. Returns the repo info for the sync worker.
   */
  async startSync(repoId: string): Promise<RepositoryInfo> {
    const repo = await this.prisma.repository.update({
      where: { id: repoId },
      data: { status: 'syncing' },
    });

    logger.info({ repoId }, 'Sync started');

    return {
      id: repo.id,
      githubUrl: repo.githubUrl,
      owner: repo.owner,
      name: repo.name,
      branch: repo.branch,
      lastSyncedSha: repo.lastSyncedSha,
      status: 'syncing',
    };
  }

  /**
   * Update the last synced SHA and set status back to idle.
   */
  async completeSyncCheckpoint(repoId: string, lastSha: string): Promise<void> {
    await this.prisma.repository.update({
      where: { id: repoId },
      data: {
        lastSyncedSha: lastSha,
        status: 'idle',
      },
    });

    logger.info({ repoId, lastSha }, 'Sync checkpoint updated');
  }

  /**
   * Set repo status to error.
   */
  async markError(repoId: string): Promise<void> {
    await this.prisma.repository.update({
      where: { id: repoId },
      data: { status: 'error' },
    });
  }

  /**
   * Get sync progress by counting commit summary statuses.
   */
  async getSyncProgress(repoId: string): Promise<SyncProgress> {
    const [total, processed, failed, pending] = await Promise.all([
      this.prisma.summary.count({ where: { repoId } }),
      this.prisma.summary.count({ where: { repoId, status: 'done' } }),
      this.prisma.summary.count({ where: { repoId, status: 'failed' } }),
      this.prisma.summary.count({
        where: { repoId, status: { in: ['pending', 'processing'] } },
      }),
    ]);

    return { total, processed, failed, pending };
  }

  /**
   * Get a single repository by ID.
   */
  async getById(repoId: string): Promise<RepositoryInfo | null> {
    const repo = await this.prisma.repository.findUnique({
      where: { id: repoId },
    });

    if (!repo) return null;

    return {
      id: repo.id,
      githubUrl: repo.githubUrl,
      owner: repo.owner,
      name: repo.name,
      branch: repo.branch,
      lastSyncedSha: repo.lastSyncedSha,
      status: repo.status as 'idle' | 'syncing' | 'error',
    };
  }

  /**
   * List all registered repositories.
   */
  async listAll(): Promise<RepositoryInfo[]> {
    const repos = await this.prisma.repository.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return repos.map((r) => ({
      id: r.id,
      githubUrl: r.githubUrl,
      owner: r.owner,
      name: r.name,
      branch: r.branch,
      lastSyncedSha: r.lastSyncedSha,
      status: r.status as 'idle' | 'syncing' | 'error',
    }));
  }
}
