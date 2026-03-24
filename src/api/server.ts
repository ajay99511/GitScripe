import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import type { PrismaClient } from '@prisma/client';
import type { Queue } from 'bullmq';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import pino from 'pino';

import { repoRoutes } from './routes/repos.js';
import { commitRoutes } from './routes/commits.js';
import { summaryRoutes } from './routes/summaries.js';
import { chatRoutes } from './routes/chat.js';
import { githubRoutes } from './routes/github.js';
import { configRoutes } from './routes/config.js';

import type { RepoManager } from '../services/RepoManager.js';
import type { SummaryStore } from '../services/SummaryStore.js';
import type { ChatService } from '../services/ChatService.js';
import type { GitHubConnector } from '../connectors/GitHubConnector.js';
import type { DiffStorage } from '../connectors/DiffStorage.js';
import type { CommitJobData } from '../queues/CommitQueue.js';
import type { AppConfig } from '../config/index.js';

export interface ServerDeps {
  prisma: PrismaClient;
  repoManager: RepoManager;
  summaryStore: SummaryStore;
  chatService: ChatService;
  githubConnector: GitHubConnector;
  diffStorage: DiffStorage;
  commitQueue: Queue<CommitJobData>;
  port: number;
  config: AppConfig;
}

export async function createServer(deps: ServerDeps) {
  const {
    prisma,
    repoManager,
    summaryStore,
    chatService,
    githubConnector,
    diffStorage,
    commitQueue,
    port,
    config,
  } = deps;

  // ─── Fastify Instance ──────────────────────────────────

  const fastify = Fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
        },
      },
    },
  });

  // ─── CORS ──────────────────────────────────────────────

  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  // ─── Bull Board — Queue Monitoring UI ──────────────────

  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [new BullMQAdapter(commitQueue)],
    serverAdapter,
  });

  await fastify.register(serverAdapter.registerPlugin() as any, {
    prefix: '/admin/queues',
  });

  // ─── Health Check ──────────────────────────────────────

  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }));

  // ─── Register API Routes ───────────────────────────────

  await repoRoutes(fastify, {
    repoManager,
    commitQueue,
    githubConnector,
    diffStorage,
    prisma,
  });

  await commitRoutes(fastify, { prisma });

  await summaryRoutes(fastify, { summaryStore, prisma, commitQueue });

  await chatRoutes(fastify, { chatService });

  await githubRoutes(fastify, { githubConnector, repoManager, prisma });

  await configRoutes(fastify, { config });

  // ─── Serve React SPA static assets ────────────────────

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.resolve(__dirname, '../../client/dist');

  if (fs.existsSync(clientDist)) {
    await fastify.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
      decorateReply: false,
    });

    fastify.setNotFoundHandler(async (request, reply) => {
      if (
        !request.url.startsWith('/repos') &&
        !request.url.startsWith('/github') &&
        !request.url.startsWith('/summaries') &&
        !request.url.startsWith('/chat') &&
        !request.url.startsWith('/health') &&
        !request.url.startsWith('/admin') &&
        !request.url.startsWith('/config') &&
        !request.url.startsWith('/socket.io')
      ) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  }

  // ─── Socket.io for Real-Time Updates ───────────────────

  const httpServer = fastify.server;
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    fastify.log.info({ socketId: socket.id }, 'Client connected');

    socket.on('subscribe:repo', (repoId: string) => {
      socket.join(`repo:${repoId}`);
      fastify.log.debug({ socketId: socket.id, repoId }, 'Subscribed to repo updates');
    });

    socket.on('disconnect', () => {
      fastify.log.debug({ socketId: socket.id }, 'Client disconnected');
    });
  });

  // Attach io instance for workers to emit events
  (fastify as any).io = io;

  // ─── Start Server ─────────────────────────────────────

  const start = async () => {
    try {
      await fastify.listen({ port, host: '0.0.0.0' });
      fastify.log.info(`🚀 GitScribe API running at http://localhost:${port}`);
      fastify.log.info(`📊 Bull Board at http://localhost:${port}/admin/queues`);
    } catch (err) {
      fastify.log.error(err);
      process.exit(1);
    }
  };

  return { fastify, io, start };
}
