import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const summaryCount = await prisma.summary.count();
    const conceptCount = await prisma.conceptLink.count();
    const latestSummary = await prisma.summary.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { commitSha: true, qualityScore: true, status: true }
    });

    console.log(`Summaries: ${summaryCount}`);
    console.log(`ConceptLinks: ${conceptCount}`);
    if (latestSummary) {
      console.log('Latest Summary:', latestSummary);
    }
    
    if (conceptCount > 0) {
        const concepts = await prisma.conceptLink.findMany({ take: 5 });
        console.log('Recent Concepts:', concepts.map(c => c.concept));
    }

  } catch (error) {
    console.error('Error checking DB:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
