# GitScribe Project Agent Guidelines

This document contains context, best practices, and known gotchas to help AI coding agents navigate the GitScribe project smoothly and avoid recurring TypeScript compilation errors.

## Project Stack
- **Runtime:** Node.js v20+ with ES Modules (ESM)
- **Language:** TypeScript 5.x
- **tsconfig:** `target: ES2022`, `moduleResolution: NodeNext`, `strict: true`
- **Framework:** Fastify
- **Database:** PostgreSQL (with `pgvector`) via Prisma ORM
- **Queue:** BullMQ (backed by Redis)
- **AI/LLM:** OpenAI + `@langchain/langgraph`

## ⚠️ Known TypeScript Pitfalls & Workarounds

During the initial build, several complex type conflicts were identified. **DO NOT** attempt to "fix" these workarounds unless explicitly requested, as they will cause compilation errors.

### 1. `ioredis` Import and ESM Compatibility
Because we use `NodeNext` module resolution, the `ioredis` default export does not behave as a constructable class type.
- **Incorrect:** `import type IORedis from 'ioredis'` or `import IORedis from 'ioredis'` (will cause "expression is not constructable" or "cannot use namespace as type").
- **Correct (Use Named Export):**
  ```typescript
  import { Redis } from 'ioredis';
  const redis = new Redis(redisUrl);
  ```

### 2. `ioredis` vs BullMQ Type Conflicts
BullMQ bundles its own version of `ioredis` types inside `--node_modules`. If you pass a top-level `Redis` instance into a BullMQ property interface (like `ConnectionOptions`), TypeScript will throw incompatible type errors.
- **Workaround:** Cast the Redis connection wrapper to `any` at the BullMQ boundary.
  ```typescript
  // src/connectors/RedisCache.ts
  getConnection(): any {
    return this.redis;
  }
  
  // src/queues/CommitQueue.ts
  export function createCommitQueue(connection: any): Queue<CommitJobData> { ... }
  ```

### 3. LangGraph `StateGraph` Compilation Types
The `StateGraph.compile()` function in `@langchain/langgraph` returns a deeply nested, complex generic type that is virtually impossible to assign to a local class property type cleanly without mismatch errors.
- **Incorrect:** `private graph: ReturnType<StateGraph<typeof PipelineAnnotation>['compile']> | null`
- **Correct (Use `any`):**
  ```typescript
  // src/orchestration/CommitPipeline.ts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private graph: any = null;
  
  // Note: you must use the non-null assertion or optional chaining when invoking
  const result = await this.graph!.invoke({ ... });
  ```

### 4. `@bull-board` Fastify Adapter Imports
The bull-board API does not require `.js` extensions for submodule imports, and Fastify type plugins conflict slightly with the Fastify 4.x types.
- **Correct Import:** `import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';` (No `.js` suffix)
- **Correct Fastify Registration:**
  ```typescript
  await fastify.register(serverAdapter.registerPlugin() as any, {
    prefix: '/admin/queues'
  });
  // Do NOT pass `basePath` into the register options (it will fail type checking)
  ```

## Prisma pgvector Handling
Prisma does not inherently support the Postgres `VECTOR` column type.
- The `embedding` field in `prisma/schema.prisma` is typed as `Unsupported("VECTOR(1536)")`.
- Vector searches and CRUD operations on the embedding field **must** be done via `$queryRawUnsafe` or `$executeRawUnsafe`.
- **See `src/services/SummaryStore.ts`** for the canonical implementation of vector search.

## AI Agent Instruction
When opening this project, an agent **must** read this file to understand the architecture constraints and avoid introducing regression errors related to the items above.
