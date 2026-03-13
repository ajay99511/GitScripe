import { Worker } from 'bullmq';

async function main() {
  console.log('Starting minimal worker for commit-processing...');
  const worker = new Worker('commit-processing', async job => {
    console.log('Processing job', job.id);
    return { success: true };
  }, { connection: { host: '127.0.0.1', port: 6379 } });

  worker.on('active', job => console.log('active:', job.id));
  worker.on('completed', job => console.log('completed:', job.id));
  worker.on('failed', (job, err) => console.log('failed:', job?.id, err));
  worker.on('error', err => console.error('worker error:', err));
}

main();
