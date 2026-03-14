import { createChatModel } from './src/services/LLMProvider.js';
import { config } from './src/config/index.js';
import { CriticAgent } from './src/agents/CriticAgent.js';

async function main() {
  const chatModel = createChatModel(config);
  const criticAgent = new CriticAgent(chatModel);
  
  console.log('--- Testing CriticAgent Structured Output ---');
  
  const commit = {
    sha: 'test-sha',
    authorName: 'Test Author',
    committedAt: new Date(),
    message: 'Added auth logic'
  };

  const draft = {
    shortSummary: "Added auth file",
    detailedSummary: "Initial implementation of the authentication middleware to secure the API routes.",
    inferredIntent: "Securing the application",
    fileSummaries: { "src/auth.ts": "Added auth file" },
    moduleSummaries: { "src/": "Added auth logic" },
    tags: ["what-auth", "how-added"],
    riskLevel: "low"
  };

  try {
    const evaluation = await criticAgent.evaluate(commit as any, draft as any);
    console.log('Critic Evaluation:', JSON.stringify(evaluation, null, 2));
  } catch (error) {
    console.error('Critic Error:', error);
  } finally {
    process.exit(0);
  }
}

main();
