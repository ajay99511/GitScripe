-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Add embedding vector column to summaries table
-- This is managed outside Prisma because Prisma doesn't natively support pgvector types
ALTER TABLE "summaries" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

-- Create HNSW index for fast approximate nearest neighbor search
CREATE INDEX IF NOT EXISTS "summaries_embedding_idx" ON "summaries" 
  USING hnsw ("embedding" vector_cosine_ops);

-- Create GIN index on tags JSONB column for tag-filtered queries
CREATE INDEX IF NOT EXISTS "summaries_tags_idx" ON "summaries" 
  USING gin ("tags");

-- Create GIN index on filesChanged for file biography queries
CREATE INDEX IF NOT EXISTS "commits_files_changed_idx" ON "commits" 
  USING gin ("filesChanged");
