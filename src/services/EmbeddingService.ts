import OpenAI from 'openai';
import pino from 'pino';

const logger = pino({ name: 'EmbeddingService' });

/**
 * Service for generating text embeddings via OpenAI's API.
 * Uses text-embedding-3-small (1536 dimensions) by default.
 */
export class EmbeddingService {
  private openai: OpenAI;
  private model: string;

  constructor(openai: OpenAI, model: string = 'text-embedding-3-small') {
    this.openai = openai;
    this.model = model;
  }

  /**
   * Generate an embedding vector for a single text input.
   */
  async embed(text: string): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: text,
      });

      return response.data[0].embedding;
    } catch (error) {
      logger.error({ error, model: this.model }, 'Embedding failed');
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts in a single API call.
   * More efficient for bulk processing during initial sync.
   */
  async batchEmbed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // OpenAI supports up to ~2048 inputs per batch; chunk if needed
    const maxBatchSize = 500;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += maxBatchSize) {
      const batch = texts.slice(i, i + maxBatchSize);

      try {
        const response = await this.openai.embeddings.create({
          model: this.model,
          input: batch,
        });

        const embeddings = response.data
          .sort((a, b) => a.index - b.index)
          .map((d) => d.embedding);

        allEmbeddings.push(...embeddings);
      } catch (error) {
        logger.error(
          { error, batchStart: i, batchSize: batch.length },
          'Batch embedding failed'
        );
        throw error;
      }
    }

    logger.info({ count: allEmbeddings.length }, 'Batch embeddings generated');
    return allEmbeddings;
  }
}
