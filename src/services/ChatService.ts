import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import pino from 'pino';
import type { SummaryStore } from './SummaryStore.js';
import type { ChatResponse, CitedCommit } from '../models/types.js';

const logger = pino({ name: 'ChatService' });

const SYSTEM_PROMPT = `You are GitScribe, an intelligent assistant that answers questions about code changes and commit history.

You will be provided with relevant commit summaries retrieved from a vector search. Use ONLY the provided context to answer the user's question. If the context doesn't contain enough information to answer, say so.

Format your response clearly and cite commit SHAs when referencing specific changes. Use the format [SHA: <first 8 chars>] for citations.

Be concise but thorough. Focus on the "why" behind changes when the user asks about decisions.`;

const USER_PROMPT_TEMPLATE = `Question: {{question}}

Relevant Commit Summaries (ordered by relevance):
{{context}}

Please answer the question based on these commit summaries. Cite commit SHAs when referencing specific changes.`;

/**
 * Service for the chat endpoint — handles question answering
 * with semantic search retrieval and LLM-generated cited answers.
 */
export class ChatService {
  private chatModel: BaseChatModel;
  private summaryStore: SummaryStore;

  constructor(chatModel: BaseChatModel, summaryStore: SummaryStore) {
    this.chatModel = chatModel;
    this.summaryStore = summaryStore;
  }

  /**
   * Answer a question by:
   * 1. Semantic search for relevant summaries
   * 2. Build context from top-K results
   * 3. Generate cited answer via LLM
   */
  async ask(question: string, repoId?: string, limit: number = 5): Promise<ChatResponse> {
    // Step 1: Retrieve relevant summaries via semantic search
    const relevant = await this.summaryStore.searchSemantic(question, repoId, limit);

    if (relevant.length === 0) {
      return {
        answer: 'I couldn\'t find any relevant commits matching your question. Try rephrasing or ensuring the repository has been synced.',
        citations: [],
      };
    }

    // Step 2: Build context string from retrieved summaries
    const context = relevant
      .map(
        (s, i) =>
          `[${i + 1}] SHA: ${s.commitSha} (relevance: ${(s.similarity * 100).toFixed(1)}%)
Summary: ${s.shortSummary}
Detail: ${s.detailedSummary}
Intent: ${s.inferredIntent}
Tags: ${s.tags.join(', ')}
Risk: ${s.riskLevel}`
      )
      .join('\n\n');

    // Step 3: Generate answer
    const userPrompt = USER_PROMPT_TEMPLATE
      .replace('{{question}}', question)
      .replace('{{context}}', context);

    try {
      const response = await this.chatModel.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(userPrompt),
      ]);

      const answer = typeof response.content === 'string' 
        ? response.content 
        : 'Unable to generate answer.';

      // Build citations from the relevant summaries
      const citations: CitedCommit[] = relevant.map((s) => ({
        sha: s.commitSha,
        shortSummary: s.shortSummary,
        committedAt: s.createdAt,
        relevanceScore: s.similarity,
      }));

      return { answer, citations };
    } catch (error) {
      logger.error({ error }, 'Chat answer generation failed');
      throw error;
    }
  }
}
