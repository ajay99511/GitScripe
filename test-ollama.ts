import { createChatModel } from './src/services/LLMProvider.js';
import { config } from './src/config/index.js';

async function main() {
  const chatModel = createChatModel(config);
  
  console.log('--- Testing Ollama Raw Response ---');
  
  try {
    const response = await chatModel.invoke([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello! Respond with just "OK" if you can hear me.' }
    ]);
    console.log('Response:', response.content);
  } catch (error) {
    console.error('Inference Error:', error);
  } finally {
    process.exit(0);
  }
}

main();
