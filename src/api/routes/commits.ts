import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { PaginationSchema } from '../../models/schemas.js';

interface CommitRouteDeps {
  prisma: PrismaClient;
}

export async function commitRoutes(
  fastify: FastifyInstance,
  deps: CommitRouteDeps
): Promise<void> {
  const { prisma } = deps;

  // ─── GET /repos/:repoId/commits — List commits for a repo ─────

  fastify.get<{ Params: { repoId: string }; Querystring: Record<string, string> }>(
    '/repos/:repoId/commits',
    async (request, reply) => {
      const { repoId } = request.params;
      const { page, limit } = PaginationSchema.parse(request.query);

      const [commits, total] = await Promise.all([
        prisma.commit.findMany({
          where: { repoId },
          orderBy: { committedAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            summary: {
              select: {
                shortSummary: true,
                status: true,
                riskLevel: true,
                tags: true,
              },
            },
          },
        }),
        prisma.commit.count({ where: { repoId } }),
      ]);

      return reply.send({
        commits: commits.map((c) => ({
          sha: c.sha,
          authorName: c.authorName,
          message: c.message.split('\n')[0], // First line only
          committedAt: c.committedAt,
          filesChanged: c.filesChanged,
          additions: c.additions,
          deletions: c.deletions,
          summary: c.summary
            ? {
                shortSummary: c.summary.shortSummary,
                status: c.summary.status,
                riskLevel: c.summary.riskLevel,
                tags: c.summary.tags,
              }
            : null,
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      });
    }
  );

  // ─── GET /commits/:sha — Get single commit with full summary ───

  fastify.get<{ Params: { sha: string } }>('/commits/:sha', async (request, reply) => {
    const { sha } = request.params;

    const commit = await prisma.commit.findUnique({
      where: { sha },
      include: {
        summary: true,
        repository: {
          select: { owner: true, name: true, branch: true },
        },
      },
    });

    if (!commit) {
      return reply.code(404).send({ error: 'Commit not found' });
    }

    return reply.send({
      sha: commit.sha,
      authorName: commit.authorName,
      authorEmail: commit.authorEmail,
      message: commit.message,
      committedAt: commit.committedAt,
      filesChanged: commit.filesChanged,
      additions: commit.additions,
      deletions: commit.deletions,
      repository: commit.repository,
      summary: commit.summary,
    });
  });
}
