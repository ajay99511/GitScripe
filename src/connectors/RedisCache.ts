import { Redis } from 'ioredis';
import pino from 'pino';

const logger = pino({ name: 'RedisCache' });

/**
 * Thin Redis wrapper for caching diffs with LRU-style eviction per repo.
 * Keeps the last N diffs per repository to avoid repeated MinIO reads.
 */
export class RedisCache {
  private redis: Redis;
  private maxDiffsPerRepo: number;

  constructor(redisUrl: string, maxDiffsPerRepo: number = 50) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // required for BullMQ compatibility
      retryStrategy: (times: number) => Math.min(times * 200, 5000),
    });
    this.maxDiffsPerRepo = maxDiffsPerRepo;

    this.redis.on('error', (err: Error) => {
      logger.error({ error: err }, 'Redis connection error');
    });

    this.redis.on('connect', () => {
      logger.info('Redis connected');
    });
  }

  /**
   * Cache a diff for a given repo + SHA.
   * Maintains an LRU list per repo, evicting oldest when over limit.
   */
  async cacheDiff(repoId: string, sha: string, diffText: string): Promise<void> {
    const key = `diff:${repoId}:${sha}`;
    const listKey = `diff-list:${repoId}`;

    try {
      const pipeline = this.redis.pipeline();
      // Store the diff with 24h TTL
      pipeline.setex(key, 86400, diffText);
      // Track in the repo's LRU list
      pipeline.lpush(listKey, sha);
      pipeline.ltrim(listKey, 0, this.maxDiffsPerRepo - 1);
      await pipeline.exec();
    } catch (error) {
      logger.warn({ error, repoId, sha }, 'Failed to cache diff (non-critical)');
    }
  }

  /**
   * Retrieve a cached diff, or null if not found.
   */
  async getCachedDiff(repoId: string, sha: string): Promise<string | null> {
    const key = `diff:${repoId}:${sha}`;
    return this.redis.get(key);
  }

  /**
   * Store arbitrary JSON value with optional TTL.
   */
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await this.redis.setex(key, ttlSeconds, serialized);
    } else {
      await this.redis.set(key, serialized);
    }
  }

  /**
   * Retrieve and parse a stored JSON value.
   */
  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  /**
   * Get the underlying Redis instance (needed by BullMQ).
   * Cast to `any` because BullMQ bundles its own ioredis types.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getConnection(): any {
    return this.redis;
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
