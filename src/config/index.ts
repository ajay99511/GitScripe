import 'dotenv/config';
import { z } from 'zod';

const ConfigSchema = z.object({
  // GitHub
  githubToken: z.string().min(1, 'GITHUB_TOKEN is required'),

  // LLM Chat
  llmProvider: z.enum(['openai', 'anthropic', 'gemini', 'ollama']).default('openai'),
  llmModel: z.string().default('gpt-4o-mini'),
  llmBaseUrl: z.string().optional(),
  
  // LLM Embeddings
  embeddingProvider: z.enum(['openai', 'gemini', 'ollama']).default('openai'),
  llmEmbeddingModel: z.string().default('text-embedding-3-small'),
  
  // API Keys (made optional, validated at runtime based on provider)
  openaiApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  geminiApiKey: z.string().optional(),
  ollamaBaseUrl: z.string().default('http://localhost:11434'),

  // Database
  databaseUrl: z.string().url('DATABASE_URL must be a valid URL'),

  // Redis
  redisUrl: z.string().default('redis://localhost:6379'),

  // MinIO / S3
  minioEndpoint: z.string().default('localhost'),
  minioPort: z.coerce.number().default(9000),
  minioAccessKey: z.string().default('minioadmin'),
  minioSecretKey: z.string().default('minioadmin'),
  minioBucket: z.string().default('gitscribe-diffs'),
  minioUseSsl: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),

  // App
  port: z.coerce.number().default(3000),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  maxConcurrentWorkers: z.coerce.number().int().min(1).max(10).default(3),
  webhookSecret: z.string().optional(),

  // LLM Rate Limiting — tune these to match your provider tier
  // Default: conservative Tier 1 values safe for OpenAI/Anthropic free/low tiers
  llmMaxJobsPerWindow: z.coerce.number().int().min(1).default(10),
  llmRateLimitWindowMs: z.coerce.number().int().min(1000).default(60000),
});

function loadConfig() {
  const result = ConfigSchema.safeParse({
    githubToken: process.env.GITHUB_TOKEN,
    llmProvider: process.env.LLM_PROVIDER,
    llmModel: process.env.LLM_MODEL,
    llmBaseUrl: process.env.LLM_BASE_URL,
    embeddingProvider: process.env.EMBEDDING_PROVIDER,
    llmEmbeddingModel: process.env.LLM_EMBEDDING_MODEL,
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    minioEndpoint: process.env.MINIO_ENDPOINT,
    minioPort: process.env.MINIO_PORT,
    minioAccessKey: process.env.MINIO_ACCESS_KEY,
    minioSecretKey: process.env.MINIO_SECRET_KEY,
    minioBucket: process.env.MINIO_BUCKET,
    minioUseSsl: process.env.MINIO_USE_SSL,
    port: process.env.PORT,
    nodeEnv: process.env.NODE_ENV,
    maxConcurrentWorkers: process.env.MAX_CONCURRENT_WORKERS,
    webhookSecret: process.env.WEBHOOK_SECRET,
    llmMaxJobsPerWindow: process.env.LLM_MAX_JOBS_PER_WINDOW,
    llmRateLimitWindowMs: process.env.LLM_RATE_LIMIT_WINDOW_MS,
  });

  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    for (const issue of result.error.issues) {
      console.error(`  → ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

export type AppConfig = z.infer<typeof ConfigSchema>;
export const config = loadConfig();
