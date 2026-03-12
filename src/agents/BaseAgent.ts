import OpenAI from 'openai';
import pino from 'pino';

const logger = pino({ name: 'BaseAgent' });

/**
 * Abstract base class for all LLM-based agents.
 * Provides shared utilities: prompt building, LLM calling, and text chunking.
 */
export abstract class BaseAgent {
  protected openai: OpenAI;
  protected model: string;

  constructor(openai: OpenAI, model: string) {
    this.openai = openai;
    this.model = model;
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
   * Call the LLM and return the text response.
   */
  protected async callLLM(
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number = 2000
  ): Promise<string> {
    const startMs = Date.now();

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content ?? '';
      const elapsed = Date.now() - startMs;

      logger.debug(
        {
          model: this.model,
          tokens: response.usage?.total_tokens,
          elapsed,
        },
        'LLM call completed'
      );

      return content;
    } catch (error) {
      logger.error({ error, model: this.model }, 'LLM call failed');
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
