import { PrismaClient } from '@prisma/client';
import { CommitPipeline } from './src/orchestration/CommitPipeline.js';
import { DiffAnalyzerAgent } from './src/agents/DiffAnalyzerAgent.js';
import { SummaryAgent } from './src/agents/SummaryAgent.js';
import { CriticAgent } from './src/agents/CriticAgent.js';
import { createChatModel } from './src/services/LLMProvider.js';
import { config } from './src/config/index.js';

async function main() {
  const prisma = new PrismaClient();
  const chatModel = createChatModel(config);
  
  const diffAnalyzer = new DiffAnalyzerAgent(chatModel);
  const summaryAgent = new SummaryAgent(chatModel);
  const criticAgent = new CriticAgent(chatModel);
  const pipeline = new CommitPipeline(diffAnalyzer, summaryAgent, criticAgent);

  console.log('--- Testing Pipeline for a single commit ---');
  
  const commit = {
    sha: 'test-sha-' + Date.now(),
    repoId: '7fdeb37f-7fc8-4acd-9ecd-c1bcde437092',
    authorName: 'Test Author',
    authorEmail: 'test@example.com',
    message: 'Added authentication middleware and concept extraction logic',
    committedAt: new Date(),
    filesChanged: ['src/auth/middleware.ts'],
    additions: 50,
    deletions: 10
  };

  const diff = `--- a/src/auth/middleware.ts
+++ b/src/auth/middleware.ts
@@ -0,0 +1,10 @@
+export const authMiddleware = (req, res, next) => {
+  const token = req.headers['authorization'];
+  if (!token) return res.status(401).send('Unauthorized');
+  next();
+};`;

  try {
    const result = await pipeline.run(commit as any, diff);
    console.log('Pipeline Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Pipeline Error:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

main();
