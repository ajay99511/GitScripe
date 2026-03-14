import { PrismaClient } from '@prisma/client';
import pino from 'pino';

import { config } from './config/index.js';

import { GitHubConnector } from './connectors/GitHubConnector.js';
import { DiffStorage } from './connectors/DiffStorage.js';
import { RedisCache } from './connectors/RedisCache.js';

import { DiffAnalyzerAgent } from './agents/DiffAnalyzerAgent.js';
import { SummaryAgent } from './agents/SummaryAgent.js';
import { CriticAgent } from './agents/CriticAgent.js';
import { CommitPipeline } from './orchestration/CommitPipeline.js';

import { RepoManager } from './services/RepoManager.js';
import { SummaryStore } from './services/SummaryStore.js';
import { EmbeddingService } from './services/EmbeddingService.js';
import { ChatService } from './services/ChatService.js';

import { createCommitQueue } from './queues/CommitQueue.js';
import { createCommitWorker } from './workers/commitWorker.js';
import { createServer } from './api/server.js';

import { createChatModel, createEmbeddingModel } from './services/LLMProvider.js';
import type { ConnectionOptions } from 'bullmq';

const logger = pino({ name: 'GitScribe' });

async function main() {
  logger.info('🚀 Starting GitScribe...');

  // ─── Initialize Core Dependencies ─────────────────────

  // Database
  const prisma = new PrismaClient();
  await prisma.$connect();
  logger.info('✅ PostgreSQL connected');

  // Redis
  const redisCache = new RedisCache(config.redisUrl);
  logger.info('✅ Redis connected');

  // MinIO / S3
  const diffStorage = new DiffStorage(
    config.minioEndpoint,
    config.minioPort,
    config.minioAccessKey,
    config.minioSecretKey,
    config.minioBucket,
    config.minioUseSsl
  );
  await diffStorage.initialize();
  logger.info('✅ MinIO initialized');

  // LLM Models via Factory
  const chatModel = createChatModel(config);
  const embeddingModel = createEmbeddingModel(config);
  logger.info('✅ LLM plugins initialized');

  // GitHub connector
  const githubConnector = new GitHubConnector(config.githubToken);

  // ─── Initialize Services ──────────────────────────────

  const embeddingService = new EmbeddingService(embeddingModel);
  const repoManager = new RepoManager(prisma);
  const summaryStore = new SummaryStore(prisma, embeddingService);

  // Recover any repos stuck in 'syncing' from a previous crashed run
  await repoManager.recoverStuckSyncs();

  // Backfill any summaries missing embeddings from a previous partial write
  await summaryStore.backfillMissingEmbeddings();
  const chatService = new ChatService(chatModel, summaryStore);

  // ─── Initialize Agent Pipeline ────────────────────────

  const diffAnalyzer = new DiffAnalyzerAgent(chatModel);
  const summaryAgent = new SummaryAgent(chatModel);
  const criticAgent = new CriticAgent(chatModel);
  const pipeline = new CommitPipeline(diffAnalyzer, summaryAgent, criticAgent);

  logger.info('✅ Agent pipeline initialized');

  // ─── Initialize Queue & Worker ────────────────────────

  const queueConnectionOpts: ConnectionOptions = { host: '127.0.0.1', port: 6379 };
  const commitQueue = createCommitQueue(queueConnectionOpts);

  const commitWorker = createCommitWorker({
    connection: queueConnectionOpts,
    concurrency: config.maxConcurrentWorkers,
    llmMaxJobsPerWindow: config.llmMaxJobsPerWindow,
    llmRateLimitWindowMs: config.llmRateLimitWindowMs,
    pipeline,
    githubConnector,
    diffStorage,
    redisCache,
    summaryStore,
    prisma,
    llmModel: config.llmModel,
  });

  logger.info(
    { concurrency: config.maxConcurrentWorkers },
    '✅ BullMQ worker started'
  );

  // ─── Start API Server ─────────────────────────────────

  const { start } = await createServer({
    prisma,
    repoManager,
    summaryStore,
    chatService,
    githubConnector,
    diffStorage,
    commitQueue,
    port: config.port,
  });

  await start();

  // ─── Graceful Shutdown ─────────────────────────────────

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down gracefully...');

    await commitWorker.close();
    await commitQueue.close();
    await redisCache.disconnect();
    await prisma.$disconnect();

    logger.info('👋 GitScribe stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.fatal({ error }, '💀 Fatal startup error');
  process.exit(1);
});
