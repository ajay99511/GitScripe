import pino from 'pino';
import { Embeddings } from '@langchain/core/embeddings';

const logger = pino({ name: 'EmbeddingService' });

/**
 * Service for generating text embeddings using LangChain's Embeddings interface.
 */
export class EmbeddingService {
  private embeddings: Embeddings;

  constructor(embeddings: Embeddings) {
    this.embeddings = embeddings;
  }

  /**
   * Generate an embedding vector for a single text input.
   */
  async embed(text: string): Promise<number[]> {
    try {
      return await this.embeddings.embedQuery(text);
    } catch (error) {
      logger.error({ error }, 'Embedding failed');
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts in a single call.
   */
  async batchEmbed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    try {
      const allEmbeddings = await this.embeddings.embedDocuments(texts);
      logger.info({ count: allEmbeddings.length }, 'Batch embeddings generated');
      return allEmbeddings;
    } catch (error) {
      logger.error({ error, batchSize: texts.length }, 'Batch embedding failed');
      throw error;
    }
  }
}
