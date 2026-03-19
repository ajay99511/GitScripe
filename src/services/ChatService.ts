import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import pino from 'pino';
import type { SummaryStore } from './SummaryStore.js';
import type { ChatResponse, CitedCommit, SummaryInfo } from '../models/types.js';

const logger = pino({ name: 'ChatService' });

const SYSTEM_PROMPT = `You are GitScribe, an intelligent assistant that answers questions about code changes and commit history.

You will be provided with relevant commit summaries retrieved from a vector search. Use ONLY the provided context to answer the user's question. If the context doesn't contain enough information to answer, say so.

Format your response clearly and cite commit SHAs when referencing specific changes. Use the format [SHA: <first 8 chars>] for citations.

Be concise but thorough. Focus on the "why" behind changes when the user asks about decisions.`;

const USER_PROMPT_TEMPLATE = `Question: {{question}}

Relevant Commit Summaries (ordered by relevance):
{{context}}

Please answer the question based on these commit summaries. Cite commit SHAs when referencing specific changes.`;

const SHA_PATTERN = /\b[0-9a-f]{7,40}\b/i;
const DATE_PATTERN =
  /\b\d{4}-\d{2}-\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2},? \d{4}\b/i;

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
   * Detect whether a question references a specific commit by SHA or date.
   * Returns the first match found, or null if neither pattern matches.
   */
  extractCommitRef(
    question: string
  ): { type: 'sha'; value: string } | { type: 'date'; value: string } | null {
    const shaMatch = question.match(SHA_PATTERN);
    if (shaMatch) return { type: 'sha', value: shaMatch[0] };

    const dateMatch = question.match(DATE_PATTERN);
    if (dateMatch) return { type: 'date', value: dateMatch[0] };

    return null;
  }

  /**
   * Answer a question by:
   * 1. Detect specific commit references (SHA or date) and perform direct lookup
   * 2. Semantic search for relevant summaries (fallback or for general questions)
   * 3. Build context from results (including filesChanged)
   * 4. Generate cited answer via LLM
   */
  async ask(question: string, repoId?: string, limit: number = 5): Promise<ChatResponse> {
    const ref = this.extractCommitRef(question);
    let relevant: (SummaryInfo & { similarity: number })[] = [];

    if (ref?.type === 'sha') {
      // Direct SHA lookup — prepend to semantic results as primary context
      const direct = await this.summaryStore.findBySha(ref.value);
      if (direct) {
        relevant = [{ ...direct, similarity: 1.0 }];
      }
      // Fall through to semantic search to supplement (or as sole source if not found)
      const semantic = await this.summaryStore.searchSemantic(question, repoId, limit);
      // Avoid duplicating the direct result
      const deduped = direct
        ? semantic.filter((s) => s.commitSha !== direct.commitSha)
        : semantic;
      relevant = [...relevant, ...deduped];
    } else if (ref?.type === 'date') {
      // Date-range lookup — parse into a full-day range
      const dateStr = ref.value;
      let start: Date;
      let end: Date;

      // Try ISO format first (YYYY-MM-DD), then natural language
      const isoMatch = dateStr.match(/\d{4}-\d{2}-\d{2}/);
      if (isoMatch) {
        start = new Date(`${isoMatch[0]}T00:00:00.000Z`);
        end = new Date(start.getTime() + 86400000); // +1 day
      } else {
        const parsed = new Date(dateStr);
        start = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
        end = new Date(start.getTime() + 86400000);
      }

      const dateResults = await this.summaryStore.findByDateRange(start, end, repoId);
      const dateWithSim = dateResults.map((s) => ({ ...s, similarity: 1.0 }));
      const semantic = await this.summaryStore.searchSemantic(question, repoId, limit);
      const directShas = new Set(dateResults.map((s) => s.commitSha));
      const deduped = semantic.filter((s) => !directShas.has(s.commitSha));
      relevant = [...dateWithSim, ...deduped];
    } else {
      // General question — semantic search only
      relevant = await this.summaryStore.searchSemantic(question, repoId, limit);
    }

    if (relevant.length === 0) {
      return {
        answer:
          "I couldn't find any relevant commits matching your question. Try rephrasing or ensuring the repository has been synced.",
        citedCommits: [],
      };
    }

    // Build context string from retrieved summaries (includes filesChanged)
    const context = relevant
      .map(
        (s, i) =>
          `[${i + 1}] SHA: ${s.commitSha} (relevance: ${(s.similarity * 100).toFixed(1)}%)
Summary: ${s.shortSummary}
Detail: ${s.detailedSummary}
Intent: ${s.inferredIntent}
Tags: ${s.tags.join(', ')}
Risk: ${s.riskLevel}
Files: ${s.filesChanged.join(', ')}`
      )
      .join('\n\n');

    const userPrompt = USER_PROMPT_TEMPLATE.replace('{{question}}', question).replace(
      '{{context}}',
      context
    );

    try {
      const response = await this.chatModel.invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(userPrompt),
      ]);

      const answer =
        typeof response.content === 'string' ? response.content : 'Unable to generate answer.';

      const citedCommits: CitedCommit[] = relevant.map((s) => ({
        sha: s.commitSha,
        shortSummary: s.shortSummary,
        committedAt: s.committedAt,
        relevanceScore: s.similarity,
      }));

      return { answer, citedCommits };
    } catch (error) {
      logger.error({ error }, 'Chat answer generation failed');
      throw error;
    }
  }
}
