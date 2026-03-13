import { Worker } from 'bullmq';
import IORedis from 'ioredis';

async function main() {
  const connection = new IORedis('redis://localhost:6379');
  
  const worker = new Worker('commits', async job => {
    console.log('Processing job', job.id);
  }, { connection });

  console.log('Test worker listening on "commits" queue...');

  worker.on('active', job => console.log('active:', job.id));
  worker.on('failed', (job, err) => console.log('failed:', job?.id, err));
  worker.on('completed', job => console.log('completed:', job.id));
}

main();
