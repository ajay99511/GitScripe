import type { FastifyInstance } from 'fastify';
import { PaginationSchema } from '../../models/schemas.js';
import type { SummaryStore } from '../../services/SummaryStore.js';

interface SummaryRouteDeps {
  summaryStore: SummaryStore;
}

export async function summaryRoutes(
  fastify: FastifyInstance,
  deps: SummaryRouteDeps
): Promise<void> {
  const { summaryStore } = deps;

  // ─── GET /repos/:repoId/summaries — Paginated summaries ────

  fastify.get<{ Params: { repoId: string }; Querystring: Record<string, string> }>(
    '/repos/:repoId/summaries',
    async (request, reply) => {
      const { repoId } = request.params;
      const { page, limit } = PaginationSchema.parse(request.query);

      const result = await summaryStore.listByRepo(repoId, page, limit);

      return reply.send({
        summaries: result.summaries,
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
}
