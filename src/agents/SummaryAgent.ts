import pino from 'pino';
import { BaseAgent } from './BaseAgent.js';
import { SummaryDraftOutputSchema } from '../models/schemas.js';
import type { CommitInfo, DiffAnalysis, SummaryDraft } from '../models/types.js';

const logger = pino({ name: 'SummaryAgent' });

const SYSTEM_PROMPT = `You are an expert engineering writer. Your job is to produce a comprehensive commit summary from a structured diff analysis.

You MUST respond with valid JSON matching this exact schema:
{
  "shortSummary": "string - 2-3 sentence headline of what this commit does",
  "detailedSummary": "string - full narrative paragraph explaining the change in depth",
  "inferredIntent": "string - WHY this change was made, inferred from the code changes and commit message",
  "fileSummaries": {
    "path/to/file.ts": "string - what changed in this specific file"
  },
  "moduleSummaries": {
    "src/auth/": "string - summary of changes in this directory/module"
  },
  "tags": ["string - architectural/functional tags like 'auth', 'refactor', 'bugfix', 'payments', 'api'"],
  "riskLevel": "low | medium | high"
}

Guidelines:
- shortSummary: Be specific, not generic. "Added OAuth2 callback handler and token refresh logic" is good. "Made changes" is bad.
- detailedSummary: Explain the change as if writing to a teammate who will review it later.
- inferredIntent: Go beyond the commit message. If the code adds error handling, the intent might be "Improving reliability of payment flow after production errors."
- tags: Use lowercase, single-word or hyphenated tags. Include both WHAT (component) and HOW (action type).
- riskLevel: "high" for auth, security, payments, database migrations. "medium" for API changes, config changes. "low" for docs, tests, formatting.
- moduleSummaries: Group by first-level directory under src/. If no clear module structure, use the file's directory.`;

const USER_PROMPT_TEMPLATE = `Generate a comprehensive commit summary from this analysis:

Commit SHA: {{sha}}
Commit Message: {{commitMessage}}
Author: {{author}}
Date: {{date}}

Diff Analysis:
- Files Changed: {{fileCount}}
- Lines Added: {{linesAdded}}, Lines Removed: {{linesRemoved}}
- Functions Modified: {{functions}}

File Details:
{{fileDetails}}`;

/**
 * Agent that generates hierarchical commit summaries with inferred intent,
 * per-file and per-module breakdowns, tags, and risk assessment.
 */
export class SummaryAgent extends BaseAgent {
  /**
   * Produce a full summary draft from a commit and its diff analysis.
   */
  async summarize(
    commit: CommitInfo,
    analysis: DiffAnalysis
  ): Promise<SummaryDraft> {
    const fileDetails = analysis.filesChanged
      .map(
        (f) =>
          `- ${f.path} (${f.changeType}): +${f.additions}/-${f.deletions} — ${f.summary}`
      )
      .join('\n');

    const prompt = this.buildPrompt(USER_PROMPT_TEMPLATE, {
      sha: commit.sha,
      commitMessage: commit.message,
      author: commit.authorName,
      date: commit.committedAt.toISOString(),
      fileCount: analysis.filesChanged.length.toString(),
      linesAdded: analysis.linesAdded.toString(),
      linesRemoved: analysis.linesRemoved.toString(),
      functions: analysis.functionsModified.join(', ') || 'None detected',
      fileDetails: fileDetails || 'No file details available',
    });

    const raw = await this.callLLM(SYSTEM_PROMPT, prompt, 3000);

    try {
      const parsed = JSON.parse(raw);
      const validated = SummaryDraftOutputSchema.parse(parsed);
      return validated;
    } catch (error) {
      logger.error({ error, raw: raw.slice(0, 200) }, 'Failed to parse summary output');
      // Return a minimal fallback
      return {
        shortSummary: commit.message.split('\n')[0] ?? 'No summary available',
        detailedSummary: `Commit by ${commit.authorName}: ${commit.message}`,
        inferredIntent: 'Unable to infer intent from LLM response.',
        fileSummaries: {},
        moduleSummaries: {},
        tags: [],
        riskLevel: 'low',
      };
    }
  }
}
