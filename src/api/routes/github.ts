import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { GitHubConnector } from '../../connectors/GitHubConnector.js';
import type { RepoManager } from '../../services/RepoManager.js';
import type { PrismaClient } from '@prisma/client';
import { RegisterDiscoveredRepoSchema } from '../../models/schemas.js';

interface GithubRouteDeps {
  githubConnector: GitHubConnector;
  repoManager: RepoManager;
  prisma: PrismaClient;
}

function normalizeUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, '').replace(/\.git$/, '');
}

export async function githubRoutes(
  fastify: FastifyInstance,
  deps: GithubRouteDeps
): Promise<void> {
  const { githubConnector, repoManager, prisma } = deps;

  // ─── GET /github/repos — List accessible repos with registration status ───

  fastify.get('/github/repos', async (_request, reply) => {
    try {
      const [accessibleRepos, registeredRows] = await Promise.all([
        githubConnector.listAccessibleRepos(),
        prisma.repository.findMany({ select: { githubUrl: true } }),
      ]);

      const registeredSet = new Set(
        registeredRows.map((r) => normalizeUrl(r.githubUrl))
      );

      const repos = accessibleRepos.map((repo) => ({
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
        defaultBranch: repo.defaultBranch,
        private: repo.private,
        description: repo.description,
        htmlUrl: repo.htmlUrl,
        isRegistered: registeredSet.has(normalizeUrl(repo.htmlUrl)),
      }));

      return reply.code(200).send({ repos });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const status = (error as { status?: number }).status;

      if (msg.toLowerCase().includes('rate limit')) {
        // Extract resetAt ISO string from message: "resets at <ISO>"
        const match = msg.match(/resets at (\S+)/i);
        const resetAt = match ? match[1] : undefined;
        return reply.code(429).send({ error: msg, resetAt });
      }

      if (status === 401) {
        return reply.code(401).send({ error: 'GitHub token is invalid or expired' });
      }

      throw error;
    }
  });

  // ─── POST /github/repos/register — Register a discovered repo ────────────

  fastify.post('/github/repos/register', async (request, reply) => {
    let body: { fullName: string; branch?: string };

    try {
      body = RegisterDiscoveredRepoSchema.parse(request.body);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: 'Validation failed',
          details: error.issues,
        });
      }
      throw error;
    }

    const [owner, repo] = body.fullName.split('/') as [string, string];

    let metadata: Awaited<ReturnType<typeof githubConnector.getRepoMetadata>>;
    try {
      metadata = await githubConnector.getRepoMetadata(owner, repo);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.toLowerCase().includes('not found or not accessible')) {
        return reply.code(404).send({ error: 'Repository not found or not accessible' });
      }
      throw error;
    }

    const effectiveBranch = body.branch ?? metadata.defaultBranch;

    // Check pre-existence before registering
    const existing = await prisma.repository.findFirst({
      where: { githubUrl: normalizeUrl(metadata.htmlUrl) },
    });

    const registered = await repoManager.register(metadata.htmlUrl, effectiveBranch);

    const statusCode = existing ? 200 : 201;
    return reply.code(statusCode).send(registered);
  });
}
