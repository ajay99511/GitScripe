import { createChatModel } from './src/services/LLMProvider.js';
import { config } from './src/config/index.js';
import { SummaryAgent } from './src/agents/SummaryAgent.js';

async function main() {
  const chatModel = createChatModel(config);
  const summaryAgent = new SummaryAgent(chatModel);
  
  console.log('--- Testing SummaryAgent Structured Output ---');
  
  const commit = {
    sha: 'test-sha',
    authorName: 'Test Author',
    committedAt: new Date(),
    message: 'Added auth logic'
  };

  const analysis = {
    filesChanged: [
      { path: 'src/auth.ts', changeType: 'added', additions: 10, deletions: 0, summary: 'Added auth file' }
    ],
    functionsModified: [],
    linesAdded: 10,
    linesRemoved: 0,
    rawSummary: 'Initial auth'
  };

  try {
    const draft = await summaryAgent.summarize(commit as any, analysis as any);
    console.log('Summary Draft:', JSON.stringify(draft, null, 2));
  } catch (error) {
    console.error('Summary Error:', error);
  } finally {
    process.exit(0);
  }
}

main();
