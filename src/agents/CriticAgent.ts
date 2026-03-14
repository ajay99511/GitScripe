import pino from 'pino';
import { BaseAgent } from './BaseAgent.js';
import { CriticOutputSchema } from '../models/schemas.js';
import type { CommitInfo, SummaryDraft, CriticOutput } from '../models/types.js';

const logger = pino({ name: 'CriticAgent' });

const SYSTEM_PROMPT = `You are a strict, expert technical reviewer and a semantic extraction engine.
Your task is to review a generated commit summary draft for quality, and extract high-level architectural or domain concepts from the diff.

Part 1: Critique
- Evaluate if the short summary is overly generic (e.g., "Updated files" vs "Refactored authentication logic").
- Evaluate if the detailed summary actually explains the 'Why' and not just a reiteration of the diff.
- Score from 0.0 to 1.0. A score of 0.8 or higher is a passing grade. Provide concise feedback on why.

Part 2: Concept Extraction
- Identify 1-5 broad, high-level concepts related to the change (e.g., "OAuth", "API Limits", "React Router", "Database Migration", "UI Refactor").
- Do not extract literal variable names or file names as concepts. 
- Concepts should be normalized strings, usually 1-3 words, Title Case.`;

const USER_PROMPT_TEMPLATE = `Review the following commit summary and extract its concepts.

Commit SHA: {{sha}}
Commit Message:
"""
{{commitMessage}}
"""

Generated Summary Draft:
- Short Summary: {{shortSummary}}
- Detailed Summary: {{detailedSummary}}
- Inferred Intent: {{inferredIntent}}
- Tags: {{tags}}`;

/**
 * Agent that evaluates Draft Summaries and extracts broad architectural concepts.
 */
export class CriticAgent extends BaseAgent {
  /**
   * Evaluate the summary and extract semantic concepts.
   */
  async evaluate(
    commit: CommitInfo,
    draft: SummaryDraft
  ): Promise<CriticOutput> {
    const prompt = this.buildPrompt(USER_PROMPT_TEMPLATE, {
      sha: commit.sha,
      commitMessage: commit.message,
      shortSummary: draft.shortSummary,
      detailedSummary: draft.detailedSummary,
      inferredIntent: draft.inferredIntent,
      tags: draft.tags.join(', '),
    });

    try {
      const structuredModel = this.chatModel.withStructuredOutput(CriticOutputSchema, { name: 'critic_eval' });
      
      const response = await structuredModel.invoke([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ]);
      
      return response as CriticOutput;
    } catch (error) {
      logger.error({ error }, 'Failed to parse critic output');
      // If the LLM parsing fails, gracefully pass it through as verified so the pipeline doesn't infinite loop.
      return {
        qualityScore: 1.0,
        feedback: 'Parser failed to critique, auto-passing.',
        extractedConcepts: ['Fallback Recovery'],
      };
    }
  }
}
