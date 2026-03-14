import { PrismaClient, Prisma } from '@prisma/client';
import pino from 'pino';
import type { SummaryDraft, SummaryInfo } from '../models/types.js';
import type { EmbeddingService } from './EmbeddingService.js';

const logger = pino({ name: 'SummaryStore' });

/**
 * Manages summary persistence, retrieval, and semantic search.
 * All operations are idempotent on commitSha.
 */
export class SummaryStore {
  private prisma: PrismaClient;
  private embeddingService: EmbeddingService;

  constructor(prisma: PrismaClient, embeddingService: EmbeddingService) {
    this.prisma = prisma;
    this.embeddingService = embeddingService;
  }

  /**
   * Upsert a summary — idempotent on commitSha.
   * Generates and stores embedding vector for semantic search.
   */
  async upsert(
    commitSha: string,
    repoId: string,
    draft: SummaryDraft,
    llmModel: string,
    processingMs: number,
    qualityScore: number,
    extractedConcepts: string[]
  ): Promise<void> {
    // Build text for embedding: combine short + detailed summary + intent
    const embeddingText = [
      draft.shortSummary,
      draft.detailedSummary,
      draft.inferredIntent,
      `Tags: ${draft.tags.join(', ')}`,
      `Concepts: ${extractedConcepts.join(', ')}`,
    ].join('\n\n');

    let embedding: number[];
    try {
      embedding = await this.embeddingService.embed(embeddingText);
    } catch (error) {
      logger.warn({ error, commitSha }, 'Embedding generation failed, storing without vector');
      embedding = [];
    }

    // Upsert the summary record and concept links inside a transaction
    await this.prisma.$transaction(async (tx) => {
      await tx.summary.upsert({
        where: { commitSha },
        create: {
          commitSha,
          repoId,
          shortSummary: draft.shortSummary,
          detailedSummary: draft.detailedSummary,
          inferredIntent: draft.inferredIntent,
          fileSummaries: draft.fileSummaries as Prisma.InputJsonValue,
          moduleSummaries: draft.moduleSummaries as Prisma.InputJsonValue,
          tags: draft.tags as Prisma.InputJsonValue,
          riskLevel: draft.riskLevel,
          qualityScore,
          llmModel,
          processingMs,
          status: 'done',
        },
        update: {
          shortSummary: draft.shortSummary,
          detailedSummary: draft.detailedSummary,
          inferredIntent: draft.inferredIntent,
          fileSummaries: draft.fileSummaries as Prisma.InputJsonValue,
          moduleSummaries: draft.moduleSummaries as Prisma.InputJsonValue,
          tags: draft.tags as Prisma.InputJsonValue,
          riskLevel: draft.riskLevel,
          qualityScore,
          llmModel,
          processingMs,
          status: 'done',
        },
      });

      // Erase any existing concepts for this commit and insert the new ones
      await tx.conceptLink.deleteMany({ where: { commitSha } });
      
      if (extractedConcepts.length > 0) {
        await tx.conceptLink.createMany({
          data: extractedConcepts.map((concept) => ({
            concept,
            commitSha,
            repoId,
            confidence: qualityScore,
          })),
        });
      }
    });

    // Store embedding via raw SQL (Prisma doesn't support vector type)
    if (embedding.length > 0) {
      const vectorStr = `[${embedding.join(',')}]`;
      await this.prisma.$executeRawUnsafe(
        `UPDATE "summaries" SET "embedding" = $1::vector WHERE "commitSha" = $2`,
        vectorStr,
        commitSha
      );
    }

    logger.info({ commitSha, hasEmbedding: embedding.length > 0 }, 'Summary upserted');
  }

  /**
   * Mark a summary as failed with an error message.
   */
  async markFailed(commitSha: string, repoId: string, errorMessage: string): Promise<void> {
    await this.prisma.summary.upsert({
      where: { commitSha },
      create: {
        commitSha,
        repoId,
        shortSummary: '',
        detailedSummary: '',
        inferredIntent: '',
        status: 'failed',
        errorMessage,
      },
      update: {
        status: 'failed',
        errorMessage,
      },
    });
  }

  /**
   * Find a summary by commit SHA.
   */
  async findBySha(sha: string): Promise<SummaryInfo | null> {
    const summary = await this.prisma.summary.findUnique({
      where: { commitSha: sha },
    });

    if (!summary) return null;
    return this.toSummaryInfo(summary);
  }

  /**
   * Semantic search across summaries using pgvector cosine similarity.
   */
  async searchSemantic(
    query: string,
    repoId?: string,
    limit: number = 5
  ): Promise<(SummaryInfo & { similarity: number })[]> {
    const queryEmbedding = await this.embeddingService.embed(query);
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    let sql: string;
    let params: unknown[];

    if (repoId) {
      sql = `
        SELECT *, 1 - (embedding <=> $1::vector) as similarity
        FROM "summaries"
        WHERE "repoId" = $2::uuid
          AND "status" = 'done'
          AND "embedding" IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT $3
      `;
      params = [vectorStr, repoId, limit];
    } else {
      sql = `
        SELECT *, 1 - (embedding <=> $1::vector) as similarity
        FROM "summaries"
        WHERE "status" = 'done'
          AND "embedding" IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT $2
      `;
      params = [vectorStr, limit];
    }

    const results = await this.prisma.$queryRawUnsafe<
      (Record<string, unknown> & { similarity: number })[]
    >(sql, ...params);

    return results.map((r) => ({
      ...this.rawToSummaryInfo(r),
      similarity: Number(r.similarity),
    }));
  }

  /**
   * Get the full biography of a file — all summaries that mention this file path.
   */
  async getFileBiography(
    filePath: string,
    repoId: string
  ): Promise<SummaryInfo[]> {
    // Query commits where filesChanged JSONB array contains the file path
    const results = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT s.*
      FROM "summaries" s
      JOIN "commits" c ON s."commitSha" = c."sha"
      WHERE c."repoId" = ${repoId}::uuid
        AND c."filesChanged" @> ${JSON.stringify([filePath])}::jsonb
        AND s."status" = 'done'
      ORDER BY c."committedAt" ASC
    `;

    return results.map((r) => this.rawToSummaryInfo(r));
  }

  /**
   * List summaries for a repo, paginated.
   */
  async listByRepo(
    repoId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{ summaries: SummaryInfo[]; total: number }> {
    const [summaries, total] = await Promise.all([
      this.prisma.summary.findMany({
        where: { repoId, status: 'done' },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.summary.count({
        where: { repoId, status: 'done' },
      }),
    ]);

    return {
      summaries: summaries.map((s) => this.toSummaryInfo(s)),
      total,
    };
  }

  // ─── Private Helpers ─────────────────────────────────

  private toSummaryInfo(s: {
    id: string;
    commitSha: string;
    repoId: string;
    shortSummary: string;
    detailedSummary: string;
    inferredIntent: string;
    fileSummaries: Prisma.JsonValue;
    moduleSummaries: Prisma.JsonValue;
    tags: Prisma.JsonValue;
    riskLevel: string;
    qualityScore: number | null;
    llmModel: string | null;
    processingMs: number | null;
    status: string;
    errorMessage: string | null;
    createdAt: Date;
  }): SummaryInfo {
    return {
      id: s.id,
      commitSha: s.commitSha,
      repoId: s.repoId,
      shortSummary: s.shortSummary,
      detailedSummary: s.detailedSummary,
      inferredIntent: s.inferredIntent,
      fileSummaries: (s.fileSummaries ?? {}) as Record<string, string>,
      moduleSummaries: (s.moduleSummaries ?? {}) as Record<string, string>,
      tags: (s.tags ?? []) as string[],
      riskLevel: s.riskLevel as 'low' | 'medium' | 'high',
      qualityScore: s.qualityScore,
      llmModel: s.llmModel,
      processingMs: s.processingMs,
      status: s.status as 'pending' | 'processing' | 'done' | 'failed',
      errorMessage: s.errorMessage,
      createdAt: s.createdAt,
    };
  }

  private rawToSummaryInfo(r: Record<string, unknown>): SummaryInfo {
    return {
      id: r.id as string,
      commitSha: r.commitSha as string,
      repoId: r.repoId as string,
      shortSummary: r.shortSummary as string,
      detailedSummary: r.detailedSummary as string,
      inferredIntent: r.inferredIntent as string,
      fileSummaries: (r.fileSummaries ?? {}) as Record<string, string>,
      moduleSummaries: (r.moduleSummaries ?? {}) as Record<string, string>,
      tags: (r.tags ?? []) as string[],
      riskLevel: (r.riskLevel as string) as 'low' | 'medium' | 'high',
      qualityScore: r.qualityScore as number | null,
      llmModel: r.llmModel as string | null,
      processingMs: r.processingMs as number | null,
      status: (r.status as string) as 'pending' | 'processing' | 'done' | 'failed',
      errorMessage: r.errorMessage as string | null,
      createdAt: r.createdAt as Date,
    };
  }
}
