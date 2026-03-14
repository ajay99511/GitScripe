import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { z } from 'zod';

// ─── Job Data Schema ─────────────────────────────────────

export const CommitJobSchema = z.object({
  sha: z.string(),
  repoId: z.string().uuid(),
  owner: z.string(),
  repo: z.string(),
  branch: z.string(),
});

export type CommitJobData = z.infer<typeof CommitJobSchema>;

// ─── Queue Definition ────────────────────────────────────

const QUEUE_NAME = 'commit-processing';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createCommitQueue(connection: ConnectionOptions): Queue<CommitJobData> {
  return new Queue<CommitJobData>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 500 },
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    },
  });
}

export { QUEUE_NAME };
