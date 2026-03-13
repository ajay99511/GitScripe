import { Queue } from 'bullmq';

async function main() {
  const queue = new Queue('commit-processing', { connection: { host: '127.0.0.1', port: 6379 } });
  const failedJobs = await queue.getFailed();
  
  for (const job of failedJobs) {
    if (job) {
      console.log(`Job ${job.id} failed:`, job.failedReason);
      console.log(`Stack trace:`, job.stacktrace);
    }
  }
  process.exit(0);
}

main();
