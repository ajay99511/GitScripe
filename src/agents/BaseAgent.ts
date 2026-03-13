import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import pino from 'pino';

const logger = pino({ name: 'BaseAgent' });

/**
 * Abstract base class for all LLM-based agents.
 * Provides shared utilities: prompt building, LLM calling, and text chunking.
 */
export abstract class BaseAgent {
  protected chatModel: BaseChatModel;

  constructor(chatModel: BaseChatModel) {
    this.chatModel = chatModel;
  }

  /**
   * Build a prompt by replacing {{variables}} in a template string.
   */
  protected buildPrompt(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return result;
  }

  /**
   * Helper that subclasses can override/use if they want raw string calling.
   * However, most agents will use `this.chatModel.withStructuredOutput()` directly now.
   */
  protected async callLLMRaw(
    systemPrompt: string,
    userPrompt: string
  ): Promise<string> {
    const startMs = Date.now();

    try {
      const response = await this.chatModel.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const content = typeof response.content === 'string' ? response.content : '';
      const elapsed = Date.now() - startMs;

      logger.debug(
        { elapsed },
        'LLM call completed'
      );

      return content;
    } catch (error) {
      logger.error({ error }, 'LLM call failed');
      throw error;
    }
  }

  /**
   * Chunk text for large diffs that exceed token limits.
   * Splits on file boundaries (diff headers) when possible.
   */
  protected chunkText(text: string, maxChars: number = 12000): string[] {
    if (text.length <= maxChars) return [text];

    const chunks: string[] = [];
    // Try splitting on diff file headers
    const fileSections = text.split(/(?=^diff --git)/m);

    let currentChunk = '';
    for (const section of fileSections) {
      if (currentChunk.length + section.length > maxChars) {
        if (currentChunk) chunks.push(currentChunk);
        // If a single section is too large, split it by lines
        if (section.length > maxChars) {
          const lines = section.split('\n');
          currentChunk = '';
          for (const line of lines) {
            if (currentChunk.length + line.length + 1 > maxChars) {
              chunks.push(currentChunk);
              currentChunk = line;
            } else {
              currentChunk += (currentChunk ? '\n' : '') + line;
            }
          }
        } else {
          currentChunk = section;
        }
      } else {
        currentChunk += section;
      }
    }

    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  }
}
