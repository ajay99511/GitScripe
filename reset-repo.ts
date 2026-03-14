import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const githubUrl = 'https://github.com/octocat/Hello-World';
  const owner = 'octocat';
  const name = 'Hello-World';
  
  // Find repo by unique githubUrl
  let repo = await prisma.repository.findUnique({ where: { githubUrl } });
  
  if (!repo) {
    repo = await prisma.repository.create({
      data: {
        githubUrl,
        owner,
        name,
        branch: 'master', // Hello-World still uses master
        status: 'idle',
      }
    });
    console.log(`Created repository ${name} with ID ${repo.id}`);
  } else {
    // Reset existing repo
    await prisma.repository.update({
      where: { id: repo.id },
      data: { lastSyncedSha: null, status: 'idle' }
    });
    console.log(`Reset repository ${name} with ID ${repo.id}`);
  }
  
  // Delete all cascades
  await prisma.summary.deleteMany({ where: { repoId: repo.id } });
  await prisma.commit.deleteMany({ where: { repoId: repo.id } });
  await prisma.conceptLink.deleteMany({ where: { repoId: repo.id } });
  
  console.log('Finished clearing cascades and concepts');
  await prisma.$disconnect();
}

main();
