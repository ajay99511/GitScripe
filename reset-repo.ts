import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const repoId = 'f2f7d36e-b66f-4f52-b0ed-421136b880be';
  
  await prisma.repository.update({
    where: { id: repoId },
    data: { lastSyncedSha: null }
  });
  
  await prisma.summary.deleteMany({ where: { repoId } });
  await prisma.commit.deleteMany({ where: { repoId } });
  
  console.log('Reset Hello-World repository');
  await prisma.$disconnect();
}

main();
