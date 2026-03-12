import type { FastifyInstance } from 'fastify';
import { RegisterRepoSchema, PaginationSchema } from '../../models/schemas.js';
import type { RepoManager } from '../../services/RepoManager.js';
import type { Queue } from 'bullmq';
import type { CommitJobData } from '../../queues/CommitQueue.js';
import { runSync } from '../../workers/syncWorker.js';
import type { GitHubConnector } from '../../connectors/GitHubConnector.js';
import type { DiffStorage } from '../../connectors/DiffStorage.js';
import type { PrismaClient } from '@prisma/client';

interface RepoRouteDeps {
  repoManager: RepoManager;
  commitQueue: Queue<CommitJobData>;
  githubConnector: GitHubConnector;
  diffStorage: DiffStorage;
  prisma: PrismaClient;
}

export async function repoRoutes(
  fastify: FastifyInstance,
  deps: RepoRouteDeps
): Promise<void> {
  const { repoManager, commitQueue, githubConnector, diffStorage, prisma } = deps;

  // ─── POST /repos — Register a repository ──────────────

  fastify.post('/repos', async (request, reply) => {
    try {
      const body = RegisterRepoSchema.parse(request.body);
      const repo = await repoManager.register(body.githubUrl, body.branch);
      return reply.code(201).send(repo);
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return reply.code(400).send({ error: 'Validation failed', details: error });
      }
      throw error;
    }
  });

  // ─── GET /repos — List all repositories ────────────────

  fastify.get('/repos', async (_request, reply) => {
    const repos = await repoManager.listAll();
    return reply.send({ repos });
  });

  // ─── POST /repos/:id/sync — Trigger sync ──────────────

  fastify.post<{ Params: { id: string } }>('/repos/:id/sync', async (request, reply) => {
    const { id } = request.params;

    const repo = await repoManager.getById(id);
    if (!repo) {
      return reply.code(404).send({ error: 'Repository not found' });
    }

    if (repo.status === 'syncing') {
      return reply.code(409).send({ error: 'Sync already in progress' });
    }

    // Run sync in background (don't await)
    runSync(id, {
      prisma,
      githubConnector,
      diffStorage,
      repoManager,
      commitQueue,
    }).catch((err) => {
      fastify.log.error({ error: err, repoId: id }, 'Background sync failed');
    });

    return reply.code(202).send({
      message: 'Sync started',
      repoId: id,
    });
  });

  // ─── GET /repos/:id/progress — Sync progress ──────────

  fastify.get<{ Params: { id: string } }>('/repos/:id/progress', async (request, reply) => {
    const { id } = request.params;

    const repo = await repoManager.getById(id);
    if (!repo) {
      return reply.code(404).send({ error: 'Repository not found' });
    }

    const progress = await repoManager.getSyncProgress(id);
    return reply.send({
      repo: { id: repo.id, owner: repo.owner, name: repo.name, status: repo.status },
      progress,
    });
  });
}
