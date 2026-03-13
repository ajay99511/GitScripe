import IORedis from 'ioredis';
async function main() {
  const redis = new IORedis('redis://localhost:6379');
  await redis.flushall();
  console.log('Redis flushed');
  process.exit(0);
}
main();
