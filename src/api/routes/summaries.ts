import type { FastifyInstance } from 'fastify';
import { PaginationSchema } from '../../models/schemas.js';
import type { SummaryStore } from '../../services/SummaryStore.js';
import type { PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';
import type { CommitJobData } from '../../queues/CommitQueue.js';
import { z } from 'zod';

interface SummaryRouteDeps {
  summaryStore: SummaryStore;
  prisma: PrismaClient;
  commitQueue: Queue<CommitJobData>;
}

export async function summaryRoutes(
  fastify: FastifyInstance,
  deps: SummaryRouteDeps
): Promise<void> {
  const { summaryStore, prisma, commitQueue } = deps;

  // ─── GET /repos/:repoId/summaries — Paginated summaries ────

  fastify.get<{ Params: { repoId: string }; Querystring: Record<string, string> }>(
    '/repos/:repoId/summaries',
    async (request, reply) => {
      const { repoId } = request.params;
      const { page, limit } = PaginationSchema.parse(request.query);

      const [result, repo] = await Promise.all([
        summaryStore.listByRepo(repoId, page, limit),
        prisma.repository.findUnique({ where: { id: repoId } }),
      ]);

      const summaries = result.summaries.map((s) => ({
        ...s,
        htmlUrl: repo && s.status === 'done'
          ? `https://github.com/${repo.owner}/${repo.name}/commit/${s.commitSha}`
          : s.htmlUrl,
      }));

      return reply.send({
        summaries,
        pagination: {
          page,
          limit,
          total: result.total,
          pages: Math.ceil(result.total / limit),
        },
      });
    }
  );

  // ─── GET /summaries/:sha — Single summary by commit SHA ────

  fastify.get<{ Params: { sha: string } }>('/summaries/:sha', async (request, reply) => {
    const { sha } = request.params;

    const summary = await summaryStore.findBySha(sha);
    if (!summary) {
      return reply.code(404).send({ error: 'Summary not found' });
    }

    return reply.send(summary);
  });

  // ─── GET /repos/:repoId/file-biography — File history ──────

  fastify.get<{
    Params: { repoId: string };
    Querystring: { path: string };
  }>('/repos/:repoId/file-biography', async (request, reply) => {
    const { repoId } = request.params;
    const { path } = request.query;

    if (!path) {
      return reply.code(400).send({ error: 'Query parameter "path" is required' });
    }

    const biography = await summaryStore.getFileBiography(path, repoId);

    return reply.send({
      filePath: path,
      repoId,
      commits: biography.length,
      history: biography,
    });
  });

  // ─── POST /repos/:repoId/summaries/resummarize — Force re-process commits ──

  const ResummarizeBodySchema = z.object({
    shas: z.array(z.string()).min(1, 'shas array must not be empty'),
    model: z.string().min(1, 'model is required'),
  });

  fastify.post<{ Params: { repoId: string } }>(
    '/repos/:repoId/summaries/resummarize',
    async (request, reply) => {
      const { repoId } = request.params;

      let body: { shas: string[]; model: string };
      try {
        body = ResummarizeBodySchema.parse(request.body);
      } catch {
        return reply.code(400).send({ error: 'shas array must not be empty' });
      }

      const { shas, model } = body;

      // Verify the repo exists and get owner/name/branch for job data
      const repo = await prisma.repository.findUnique({ where: { id: repoId } });
      if (!repo) {
        return reply.code(404).send({ error: 'Repository not found' });
      }

      // Verify all commit SHAs exist
      for (const sha of shas) {
        const commit = await prisma.commit.findUnique({ where: { sha } });
        if (!commit) {
          return reply.code(404).send({ error: 'Commit not found', sha });
        }
      }

      // Reset summaries to pending
      await summaryStore.resetToPending(shas);

      // Enqueue force re-summarize jobs
      for (const sha of shas) {
        await commitQueue.add(
          `resummarize-${sha}`,
          {
            sha,
            repoId,
            owner: repo.owner,
            repo: repo.name,
            branch: repo.branch,
            force: true,
            overrideModel: model,
          },
          { jobId: `force-${sha}` }
        );
      }

      return reply.code(202).send({ enqueued: shas.length });
    }
  );
}
